import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import { contextAgentIdentity, contextTargetAgent } from "./agent-identity.js";
import { type NotesOwner, OWNER_CHANNEL, type OwnerRequest } from "./bridge.js";
import { optionalPccMissing } from "./integrations.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { modelIsActive } from "./settings.js";
import { registerContextSharingService } from "./sharing-service.js";

export async function registerNotesSharing(
	pi: ExtensionAPI,
	owner: NotesOwner,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
) {
	const route = registerContextSharingService(pi, {
		enabled: () => activation.available,
		shareSubagentContext: () =>
			lifecycle.active && activation.settings.shareSubagentContext,
		owner: () => owner,
		execute: (ctx, request, signal) =>
			owner.executeShared!(
				{ namespace: request.namespace, params: request.params },
				randomUUID(),
				ctx,
				signal,
			),
	});
	let remote: Pick<
		import("./bridge.js").NotesBridge,
		"lookup" | "canProject" | "projectResult"
	> = {};
	try {
		const { createNotesRemoteService } = await import("./remote.js");
		remote = createNotesRemoteService(pi);
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
	}
	const family = {
		...remote,
		protocol: 1 as const,
		agentName: (ctx: ExtensionContext) => contextAgentIdentity(ctx).agentName,
		route: async (
			query: import("./bridge.js").LookupQuery,
			callId: string,
			ctx: ExtensionContext,
			signal?: AbortSignal,
		) => {
			const identity = contextAgentIdentity(ctx);
			const target = contextTargetAgent(
				query.namespace,
				query.params,
				identity.agentName,
			);
			if (target === identity.agentName) return undefined;
			const result = await route(
				ctx,
				{ ...query, sessionId: identity.sessionId, agentName: target },
				signal,
			);
			if (
				query.namespace === "history" &&
				result &&
				(result.details.externalNotesResponses?.length ||
					"protectedOutputs" in result.details)
			)
				throw new Error(
					"That agent returned encrypted history instead of Pi session history. Update and reload Notes on the other agent, or open its saved Pi JSONL session locally.",
				);
			if (!result?.details.externalNotesResponses?.length) return result;
			const { externalNotesResponses, ...details } = result.details;
			if (!remote.projectResult || remote.canProject?.(ctx) === false)
				return {
					...result,
					details,
					content: [
						...result.content,
						{
							type: "text" as const,
							text: "Shared encrypted contents are unavailable on this model. Local results remain available. Use a compatible Codex model with PCC for remote contents.",
						},
					],
				};
			return remote.projectResult(
				{ ...result, details },
				externalNotesResponses.map(({ bytesBase64, ...response }) => ({
					...response,
					bytes: Uint8Array.from(Buffer.from(bytesBase64, "base64")),
				})),
				callId,
				ctx,
				signal,
				true,
			);
		},
	};
	const stopOwner = pi.events.on(OWNER_CHANNEL, (data) => {
		if (!data || typeof data !== "object") return;
		const request = data as Partial<OwnerRequest>;
		if (request.protocol === 1 && activation.available)
			request.projection?.(owner);
		if (
			request.protocol === 1 &&
			typeof request.reply === "function" &&
			activation.available &&
			(request.ctx
				? modelIsActive(activation.settings, request.ctx.model)
				: lifecycle.active)
		)
			request.reply(owner);
	});

	return { family, stopOwner };
}
