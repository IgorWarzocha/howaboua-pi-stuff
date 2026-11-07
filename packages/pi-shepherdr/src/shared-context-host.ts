import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	connectNotesContextSharing,
	type SharedContextRequest,
	type SharedContextResult,
} from "@howaboua/pi-agent-comms/context-sharing";
import { attachmentOwner, attachmentRoutes } from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet/index.js";
import {
	listenContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import { savedContextLoader } from "./saved-context.js";
import { SharedAgentContext } from "./shared-context.js";

export async function registerSharedAgentContext(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	board: AgentBoard,
): Promise<SharedAgentContext> {
	let started = false;
	const connection = connectNotesContextSharing(pi, () => {
		if (started) connectRoutes();
	});
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
	const notes = () =>
		connection?.service?.registerSavedSessionLoader
			? connection.service
			: undefined;
	const shared = new SharedAgentContext(
		pi,
		fleet,
		notes,
		board,
		() => relationships?.service,
	);
	let close: (() => Promise<void>) | undefined;
	let unregister: (() => void) | undefined;
	let unregisterSaved: (() => void) | undefined;
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
	const connectRoutes = () => {
		unregister?.();
		unregisterSaved?.();
		unregisterSaved = notes()?.registerSavedSessionLoader?.(
			savedContextLoader(fleet),
		);
		unregister = notes()?.registerRouter(
			Object.assign(
				async (
					context: ExtensionContext,
					request: SharedContextRequest,
					signal?: AbortSignal,
				) => {
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
	};
	pi.on("session_start", async () => {
		await close?.();
		close = undefined;
		started = true;
		connectRoutes();
	});
	pi.on("resources_discover", async (_event, ctx) => {
		await publish(ctx);
		await fleet.restoreSharing(ctx);
	});
	pi.on("session_shutdown", async () => {
		started = false;
		unregister?.();
		unregisterSaved?.();
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
