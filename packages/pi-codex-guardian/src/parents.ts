import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CODEX_ENDPOINT,
	isRecord,
	MAX_REVIEW_BYTES,
	REVIEW_MODEL,
	serializeReview,
} from "./review.js";

interface Parent {
	responseId: string;
	model: Model<Api>;
	sessionId: string;
	context: string;
}

interface PendingParent {
	model: Model<Api>;
	sessionId: string;
	context: string;
	completedId?: string;
}

function supportsParent(
	ctx: ExtensionContext,
): ctx is ExtensionContext & { model: Model<Api> } {
	if (
		!ctx.model ||
		ctx.model.api !== "openai-codex-responses" ||
		!ctx.modelRegistry.isUsingOAuth(ctx.model) ||
		ctx.modelRegistry.getProviderAuthStatus(ctx.model.provider).source !==
			"stored"
	)
		return false;
	const provider = ctx.modelRegistry.getProvider(ctx.model.provider);
	const override = ctx.modelRegistry.getRegisteredProviderConfig(
		ctx.model.provider,
	);
	// Match Codex's native-backend eligibility, not just an OAuth-looking model URL.
	// An API-key handler includes configured keys, environment auth and cloud credentials.
	if (
		!provider?.auth.oauth?.isSubscription ||
		provider.auth.apiKey ||
		override?.oauth ||
		override?.streamSimple
	)
		return false;
	const endpoints = [
		"https://chatgpt.com/backend-api",
		"https://chatgpt.com/backend-api/codex",
		CODEX_ENDPOINT,
	];
	return [ctx.model.baseUrl, provider.baseUrl].every((base) =>
		endpoints.includes(base?.replace(/\/+$/, "") ?? ""),
	);
}

function opaqueInput(item: unknown): boolean {
	if (!isRecord(item)) return false;
	if (["compaction", "item_reference"].includes(String(item["type"])))
		return true;
	const content = item["content"];
	return (
		Array.isArray(content) &&
		content.some(
			(part) =>
				isRecord(part) &&
				["input_image", "input_file", "input_audio"].includes(
					String(part["type"]),
				),
		)
	);
}

/** Only live, observed parent responses. Never restore response IDs from session history. */
export class ParentBindings {
	private requestPrepared = false;
	private pending: PendingParent | undefined;
	private readonly byCall = new Map<string, Parent>();
	private retainedBytes = 0;
	contextUnavailable = false;

	clear(): void {
		this.requestPrepared = false;
		this.pending = undefined;
		this.byCall.clear();
		this.retainedBytes = 0;
		this.contextUnavailable = false;
	}

	register(
		pi: ExtensionAPI,
		isEnabled: (ctx: ExtensionContext) => boolean,
	): void {
		pi.on("context_with_system", (_event, ctx) => {
			this.pending = undefined;
			this.requestPrepared = isEnabled(ctx);
			this.contextUnavailable = false;
		});
		pi.on("before_provider_request", (event, ctx) => {
			this.pending = undefined;
			if (!isRecord(event.payload)) return;
			const payload = event.payload;
			const existingMetadata = isRecord(payload["client_metadata"]);
			const metadata = {
				...(isRecord(payload["client_metadata"])
					? payload["client_metadata"]
					: {}),
			};
			delete metadata["guardian_credits_requested"];
			delete metadata["parent_response_id"];
			if (!isEnabled(ctx)) {
				if (existingMetadata) payload["client_metadata"] = metadata;
				return;
			}
			// Codex excludes Guardian's own basic/reviewer sessions from earning parent credits.
			const reviewer =
				payload["model"] === REVIEW_MODEL ||
				metadata["x-openai-subagent"] === "guardian";
			payload["client_metadata"] = metadata;
			if (reviewer || !supportsParent(ctx)) return;
			metadata["guardian_credits_requested"] = "true";
			// No synthetic parent linkage on ordinary requests.
			if (!this.requestPrepared || payload["model"] !== ctx.model.id) return;
			this.requestPrepared = false;
			// The prepared wire request already contains the selected system and transcript.
			// Opaque checkpoint/referenced history is not authorization we can inspect.
			const input = payload["input"];
			const first = Array.isArray(input) ? input[0] : undefined;
			const responsesLite =
				payload["instructions"] === undefined &&
				payload["tools"] === undefined &&
				isRecord(first) &&
				first["type"] === "additional_tools" &&
				first["role"] === "developer" &&
				Array.isArray(first["tools"]);
			if (
				(typeof payload["instructions"] !== "string" && !responsesLite) ||
				!Array.isArray(input) ||
				payload["previous_response_id"] ||
				input.some(opaqueInput)
			) {
				this.contextUnavailable = true;
				return;
			}
			try {
				this.pending = {
					model: structuredClone(ctx.model),
					sessionId: ctx.sessionManager.getSessionId(),
					context: serializeReview({
						instructions: payload["instructions"],
						input: payload["input"],
						tools: payload["tools"],
					}),
				};
			} catch {
				this.contextUnavailable = true;
			}
		});
		pi.on("provider_stream_event", (event, ctx) => {
			const pending = this.pending;
			if (
				!isEnabled(ctx) ||
				!pending ||
				!supportsParent(ctx) ||
				pending.sessionId !== ctx.sessionManager.getSessionId() ||
				event.provider !== pending.model.provider ||
				event.api !== pending.model.api ||
				event.model !== pending.model.id ||
				!isRecord(event.data) ||
				event.data["type"] !== "response.completed"
			)
				return;
			const response = event.data["response"];
			if (
				isRecord(response) &&
				response["status"] === "completed" &&
				typeof response["id"] === "string" &&
				/^resp_[a-zA-Z0-9]+$/.test(response["id"])
			)
				pending.completedId = response["id"];
		});
		pi.on("message_end", (event, ctx) => {
			const message = event.message;
			const pending = this.pending;
			if (message.role !== "assistant" || !pending) return;
			this.pending = undefined;
			if (
				!isEnabled(ctx) ||
				!supportsParent(ctx) ||
				!message.responseId ||
				message.responseId !== pending.completedId ||
				message.stopReason !== "toolUse" ||
				message.provider !== pending.model.provider ||
				message.api !== pending.model.api ||
				message.model !== pending.model.id ||
				pending.sessionId !== ctx.sessionManager.getSessionId()
			)
				return;
			const toolCalls = new Set(
				message.content
					.filter((item) => item.type === "toolCall")
					.map((item) => item.id),
			);
			if (!toolCalls.size || toolCalls.size > 128) return;
			// Retire oldest bindings, rather than making every subsequent action fail.
			while (
				this.byCall.size + toolCalls.size > 128 ||
				this.retainedBytes + Buffer.byteLength(pending.context, "utf8") >
					8 * MAX_REVIEW_BYTES
			) {
				const oldest = this.byCall.values().next().value;
				if (!oldest) return;
				for (const [id, parent] of this.byCall)
					if (parent === oldest) this.byCall.delete(id);
				this.retainedBytes -= Buffer.byteLength(oldest.context, "utf8");
			}
			const parent: Parent = { ...pending, responseId: message.responseId };
			this.retainedBytes += Buffer.byteLength(parent.context, "utf8");
			for (const id of toolCalls) this.byCall.set(id, parent);
		});
	}

	resolve(
		callId: string | undefined,
		ctx: ExtensionContext,
	): Parent | undefined {
		const parent = callId ? this.byCall.get(callId) : undefined;
		if (
			!parent ||
			!supportsParent(ctx) ||
			parent.sessionId !== ctx.sessionManager.getSessionId() ||
			parent.model.provider !== ctx.model.provider ||
			parent.model.api !== ctx.model.api ||
			parent.model.id !== ctx.model.id ||
			parent.model.baseUrl !== ctx.model.baseUrl
		)
			return;
		const stillSelected = ctx.sessionManager
			.getBranch()
			.some(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.responseId === parent.responseId,
			);
		return stillSelected ? parent : undefined;
	}

	// Native nested calls can themselves invoke Pi tools. Bind only admitted calls.
	admitted(callId: string, parent: Parent): void {
		if (this.byCall.size < 128) this.byCall.set(callId, parent);
	}
}
