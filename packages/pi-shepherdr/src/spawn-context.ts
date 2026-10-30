import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexAgentRelationshipService } from "@howaboua/pi-codex-conversion/agent-relationship";
import type { ContextSharingService } from "@howaboua/pi-notes-compaction/context-sharing";
import type { ConnectedMachine } from "./fleet/index.js";
import { sessionPath } from "./herdr.js";
import { sessionContextPath } from "./remote/shepherdr-context.mjs";
import type { PaneInfo } from "./types.js";

export const MEMBER_ENTRY = "herdr-context-child";
export interface Member {
	agentName: string;
	sessionId: string;
	threadId: string;
	machine: string;
	sessionFile: string;
}
interface Routing {
	transport: "shepherdr";
	parent: string;
}

export class SpawnContext {
	private readonly pi: ExtensionAPI;
	private readonly getRelationships: () =>
		| CodexAgentRelationshipService
		| undefined;
	private readonly getService: () => ContextSharingService | undefined;
	constructor(
		pi: ExtensionAPI,
		getService: () => ContextSharingService | undefined,
		getRelationships: () => CodexAgentRelationshipService | undefined,
	) {
		this.pi = pi;
		this.getRelationships = getRelationships;
		this.getService = getService;
	}
	canShare(ctx: ExtensionContext): boolean {
		return this.getService()?.canCreateChild(ctx) === true;
	}
	prepareRelationship(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		args: readonly string[],
	) {
		const service = this.getRelationships();
		if (!service) return undefined;
		// Session-selection profiles resume existing identities rather than creating workers.
		if (
			args.some((arg) =>
				/^(?:--(?:session(?:-id)?|continue|resume|no-session|fork)(?:=|$)|-[cr]$)/.test(
					arg,
				),
			)
		)
			return undefined;
		const parentThreadId = ctx.sessionManager.getSessionId();
		const cacheAffinityId = service.cacheAffinityId(ctx);
		const linkage = { parentThreadId, subagentKind: "collab_spawn" };
		const relationship = {
			...linkage,
			...(cacheAffinityId ? { cacheAffinityId } : {}),
		};
		return {
			accept: async (agent: PaneInfo) => {
				const file = sessionPath(agent);
				if (!file) throw new Error("Spawned agent has no saved Pi session");
				const value = await runtime.client.requestContext(
					sessionContextPath(file),
					{
						operation: "bind-relationship",
						relationship,
					},
				);
				if (ctx.sessionManager.getSessionId() !== parentThreadId)
					throw new Error("Controller session changed during spawn");
				if (value === null)
					return {
						warning:
							"Worker relationship marking requires Codex conversion on the target",
					};
				// Older targets preserve linkage but do not recognise cache affinity.
				if (cacheAffinityId && isDeepStrictEqual(value, linkage))
					return {
						warning:
							"Worker started without shared cache routing; update Codex Conversion on the target to enable it",
					};
				if (!isDeepStrictEqual(value, relationship))
					throw new Error(
						"Spawned agent did not adopt its parent relationship",
					);
				return undefined;
			},
		};
	}

	async prepare(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		name: string,
		args: readonly string[] = [],
	) {
		const service = this.getService();
		if (!service?.canCreateChild(ctx)) return undefined;
		const parent = service.describe(ctx);
		if (!parent) return undefined;
		if (
			args.some((arg) =>
				/^(?:--(?:session(?:-id)?|continue|resume|no-session|fork)(?:=|$)|-[cr]$)/.test(
					arg,
				),
			)
		)
			throw new Error(
				"Shared context spawn cannot use profile session-selection arguments; use assign for existing agents",
			);
		const parentFile = ctx.sessionManager.getSessionFile();
		if (!parentFile)
			throw new Error(
				"Shared context spawn requires a saved controller session",
			);
		await runtime.prepareSharing();
		const routing: Routing = {
			transport: "shepherdr",
			parent: runtime.local
				? sessionContextPath(parentFile)
				: runtime.client.contextRelayPath(),
		};
		const { binding, adopt } = await service.createChild(ctx, {
			name,
			routing,
		});
		return {
			accept: async (agent: PaneInfo) => {
				const sessionFile = sessionPath(agent);
				if (!sessionFile)
					throw new Error("Spawned agent has no native Pi session path");
				const value = await runtime.client.requestContext(
					sessionContextPath(sessionFile),
					{ operation: "bind", binding },
				);
				if (!value)
					return {
						warning: "Spawned without shared context: the target needs Notes",
					};
				if (
					typeof value !== "object" ||
					!("sessionId" in value) ||
					value.sessionId !== binding.sessionId ||
					!("agentName" in value) ||
					value.agentName !== binding.agentName ||
					!("storage" in value) ||
					value.storage !== binding.storage ||
					(binding.accountScope !== undefined &&
						(!("accountScope" in value) ||
							value.accountScope !== binding.accountScope))
				)
					throw new Error(
						"Spawned agent did not adopt its shared context identity and storage mode",
					);
				if (ctx.sessionManager.getSessionId() !== parent.threadId)
					throw new Error("Controller session changed during spawn");
				await adopt();
				this.pi.appendEntry<Member>(MEMBER_ENTRY, {
					agentName: binding.agentName,
					sessionId: parent.sessionId,
					threadId: parent.threadId,
					machine: runtime.machine,
					sessionFile,
				});
				return { agentName: binding.agentName };
			},
		};
	}
}
