import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-notes-compaction/context-sharing";
import { attachmentOwner, attachmentRoutes } from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet/index.js";
import {
	listenContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import { SharedAgentContext } from "./shared-context.js";

export async function registerSharedAgentContext(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	board: AgentBoard,
): Promise<SharedAgentContext> {
	let api:
		| typeof import("@howaboua/pi-notes-compaction/context-sharing")
		| undefined;
	try {
		api = await import("@howaboua/pi-notes-compaction/context-sharing");
	} catch (error) {
		const failure = error as { code?: string; message?: string };
		const missing = failure.message?.match(
			/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
		)?.[1];
		const module = "@howaboua/pi-notes-compaction/context-sharing";
		const unavailable =
			((failure.code === "ERR_MODULE_NOT_FOUND" ||
				failure.code === "MODULE_NOT_FOUND") &&
				(missing === "@howaboua/pi-notes-compaction" ||
					missing === module ||
					missing?.endsWith(`/${module}`))) ||
			(failure.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" &&
				failure.message?.includes("@howaboua/pi-notes-compaction") &&
				failure.message.includes("./context-sharing"));
		if (!unavailable)
			throw new Error(
				"Update pi-notes-compaction to use shared agent context",
				{ cause: error },
			);
	}
	const connection = api?.connectNotesContextSharing(pi);
	let relationships:
		| ReturnType<
				typeof import("@howaboua/pi-codex-conversion/agent-relationship")["connectCodexAgentRelationships"]
		  >
		| undefined;
	try {
		const relationshipApi = await import(
			"@howaboua/pi-codex-conversion/agent-relationship"
		);
		relationships = relationshipApi.connectCodexAgentRelationships(pi);
	} catch (error) {
		const failure = error as { code?: string; message?: string };
		if (
			!(
				(failure.code === "ERR_MODULE_NOT_FOUND" ||
					failure.code === "MODULE_NOT_FOUND" ||
					failure.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") &&
				failure.message?.includes("pi-codex-conversion")
			)
		)
			throw error;
	}
	const shared = new SharedAgentContext(
		pi,
		fleet,
		() => connection?.service,
		board,
		() => relationships?.service,
	);
	let close: (() => Promise<void>) | undefined;
	let unregister: (() => void) | undefined;
	const publish = async (ctx: ExtensionContext) => {
		const file = ctx.sessionManager.getSessionFile();
		if (!file) return;
		try {
			close = await listenContext(
				sessionContextPath(file),
				(request: unknown, signal: AbortSignal) =>
					shared.handle(ctx, request, signal),
			);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "SHARED_CONTEXT_ALREADY_OPEN"
			)
				throw error;
			ctx.ui.notify(
				"This session is open in another window. Agents remain available, but shared context is unavailable here. Close the other window, then /reload here to enable sharing.",
				"warning",
			);
		}
	};
	pi.on("session_start", async () => {
		await close?.();
		close = undefined;
		unregister?.();
		unregister = connection?.service?.registerRouter(
			Object.assign(
				async (
					context: ExtensionContext,
					request: SharedContextRequest,
					signal?: AbortSignal,
				) => {
					const attached = await shared.attachment.routing.route(
						context,
						request,
						[],
						(route, next) =>
							fleet
								.connected(route.machine)
								.client.requestContext(
									sessionContextPath(route.sessionFile),
									next,
									signal,
								),
						signal,
					);
					if (attached) return attached;
					return shared.handle(
						context,
						{ operation: "context", request, visited: [] },
						signal,
					) as Promise<SharedContextResult>;
				},
				{
					requiresRemoteScope: (context: ExtensionContext) =>
						attachmentOwner(context)?.context?.controller.storage ===
							"remote" ||
						attachmentRoutes(context).some(
							(route) =>
								route.phase === "ready" &&
								route.plan.context?.target.storage === "remote",
						),
				},
			),
		);
	});
	pi.on("resources_discover", async (_event, ctx) => {
		await publish(ctx);
		await fleet.restoreSharing(ctx);
	});
	pi.on("session_shutdown", async () => {
		unregister?.();
		await close?.();
		connection?.dispose();
		relationships?.dispose();
	});
	fleet.setContextRelay(
		(ctx, request, signal) => shared.handle(ctx, request, signal),
		(ctx, machine) => shared.needsRelay(ctx, machine),
	);
	return shared;
}
