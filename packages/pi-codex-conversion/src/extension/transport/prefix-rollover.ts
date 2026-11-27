import { createHash } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	getInitialSystemMessage,
	getSystemMessageText,
	type Api,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	prefixContextBranch,
	requestPrefixRollover,
} from "../../prefix-rollover.ts";
import { requestPrefixFingerprints } from "../../providers/openai-codex/diagnostic-request.ts";
import { extractAccountId } from "../../providers/openai-codex/headers.ts";
import { isResponsesLiteRequest } from "../../providers/openai-codex/responses-lite.ts";
import { projectCodexDeveloperHistory } from "../../adapter/developer-history.ts";
import {
	customDeveloperMessageMetadata,
	isCodexDeveloperMessageDetails,
} from "../../developer-messages.ts";
import {
	projectPrefixRollover,
	visibleVirtualEntries,
} from "../../providers/openai-codex/prefix-projection.ts";
import type {
	OpenAICodexStreamOptions,
	ResponsesBody,
} from "../../providers/openai-codex/types.ts";

const ENTRY = "pi-codex-conversion:prefix-identity:v1";

interface PrefixIdentity {
	protocol: 1;
	sessionId: string;
	lane: string;
	instructions: string;
	tools: string;
}
interface UnknownPrefix {
	protocol: 1;
	sessionId: string;
	lane: string;
	unknown: true;
}
type PrefixRecord = PrefixIdentity | UnknownPrefix;

function prefixLane(
	model: Model<Api>,
	options: OpenAICodexStreamOptions,
): string | undefined {
	if (!options.apiKey) return;
	return createHash("sha256")
		.update(
			JSON.stringify([
				model.provider,
				model.api,
				model.id,
				model.baseUrl,
				extractAccountId(options.apiKey),
			]),
		)
		.digest("hex");
}

function identify(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	lane: string,
	context: TranscriptContext,
	body: ResponsesBody,
): PrefixIdentity | undefined {
	const system = getInitialSystemMessage(context.messages);
	if (!system || body.instructions !== undefined) return;
	const start = isResponsesLiteRequest(body) ? 1 : 0;
	const itemText = (item: unknown): string | undefined => {
		if (
			!item ||
			typeof item !== "object" ||
			!("role" in item) ||
			item.role !== "developer" ||
			!("content" in item) ||
			!Array.isArray(item.content) ||
			item.content.length !== 1
		)
			return;
		const part = item.content[0];
		return part?.type === "input_text" && typeof part.text === "string"
			? part.text
			: undefined;
	};
	if (itemText(body.input[start]) !== getSystemMessageText(system)) return;
	const adjacent: string[] = [];
	for (let index = start + 1; index < body.input.length; index++) {
		const item = body.input[index];
		if (
			!item ||
			typeof item !== "object" ||
			!("role" in item) ||
			item.role !== "developer"
		)
			break;
		const text = itemText(item);
		if (text === undefined) return;
		adjacent.push(text);
	}
	if (adjacent.length) {
		const branch =
			prefixContextBranch(pi, ctx) ?? ctx.sessionManager.getBranch();
		const known = projectCodexDeveloperHistory(branch).flatMap((message) => {
			if (message.role !== "custom" || typeof message.content !== "string")
				return [];
			const metadata =
				customDeveloperMessageMetadata(message.details) ?? message.details;
			return isCodexDeveloperMessageDetails(metadata) ? [message.content] : [];
		});
		if (
			new Set(adjacent).size !== adjacent.length ||
			adjacent.some(
				(text) => known.filter((candidate) => candidate === text).length !== 1,
			)
		)
			return;
	}
	return {
		protocol: 1,
		sessionId: ctx.sessionManager.getSessionId(),
		lane,
		...requestPrefixFingerprints(body),
	};
}

function previousIdentity(
	ctx: ExtensionContext,
	lane: string,
): PrefixRecord | undefined {
	let id = ctx.sessionManager.getLeafId();
	while (id) {
		const entry = ctx.sessionManager.getEntry(id);
		if (!entry) return;
		if (entry.type === "custom" && entry.customType === ENTRY) {
			const data = entry.data as Partial<PrefixIdentity> | undefined;
			if (
				data?.protocol === 1 &&
				data.sessionId === ctx.sessionManager.getSessionId() &&
				data.lane === lane
			) {
				if (
					typeof data.instructions === "string" &&
					typeof data.tools === "string"
				)
					return data as PrefixIdentity;
				return { protocol: 1, sessionId: data.sessionId, lane, unknown: true };
			}
		}
		id = entry.parentId;
	}
}

function samePrefix(left: PrefixRecord, right: PrefixRecord): boolean {
	if ("unknown" in left || "unknown" in right)
		return "unknown" in left && "unknown" in right;
	return left.instructions === right.instructions && left.tools === right.tools;
}

export function createPrefixRollover(pi: ExtensionAPI) {
	let firstRequest = false;
	let candidate: PrefixRecord | undefined;
	pi.on("turn_end", (event, ctx) => {
		const current = candidate;
		candidate = undefined;
		if (
			!current ||
			ctx.signal?.aborted ||
			current.sessionId !== ctx.sessionManager.getSessionId() ||
			event.message.role !== "assistant" ||
			(event.message.stopReason !== "stop" &&
				event.message.stopReason !== "toolUse")
		)
			return;
		const previous = previousIdentity(ctx, current.lane);
		if (previous && samePrefix(previous, current)) return;
		return {
			entries: [
				...event.entries,
				{ type: "custom", customType: ENTRY, data: current },
			],
		};
	});
	return {
		begin() {
			firstRequest = true;
			candidate = undefined;
		},
		async beforeSend(
			ctx: ExtensionContext,
			model: Model<Api>,
			context: TranscriptContext,
			body: ResponsesBody,
			options: OpenAICodexStreamOptions,
			responsesLite: boolean,
			validate: (projected: ResponsesBody) => Promise<void>,
		): Promise<void> {
			const isFirst = firstRequest;
			firstRequest = false;
			const lane = prefixLane(model, options);
			if (!lane) {
				candidate = undefined;
				return;
			}
			const current = identify(pi, ctx, lane, context, body);
			candidate = current ?? {
				protocol: 1,
				sessionId: ctx.sessionManager.getSessionId(),
				lane,
				unknown: true,
			};
			if (!isFirst || !current || ctx.signal?.aborted) return;
			const previous = previousIdentity(ctx, current.lane);
			if (!previous || "unknown" in previous || samePrefix(previous, current))
				return;
			let virtual: ReturnType<typeof visibleVirtualEntries>;
			try {
				virtual = visibleVirtualEntries(
					prefixContextBranch(pi, ctx) ?? ctx.sessionManager.getBranch(),
					body,
				);
			} catch {
				return;
			}
			if (!virtual) return;
			const plan = requestPrefixRollover(
				pi,
				ctx,
				virtual.map((entry) => entry.entryId),
			);
			if (!plan) return;
			let projected: ResponsesBody | undefined;
			try {
				projected = await projectPrefixRollover(
					model,
					context,
					body,
					options,
					responsesLite,
					plan.kickoff,
					plan.carrier,
					plan.recovery,
					plan.retainedGuidance,
					virtual,
				);
				if (projected) await validate(projected);
			} catch {
				// This is an optional optimization. Keep the original request if its
				// projected form cannot be validated.
				return;
			}
			if (!projected || ctx.signal?.aborted || !plan.arm()) return;
			body.input = projected.input;
		},
	};
}
