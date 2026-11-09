import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-agent-comms/context-sharing";
import type { CodexAgentRelationshipService } from "@howaboua/pi-codex-conversion/agent-relationship";
import { Check } from "typebox/value";
import { AgentAttachment } from "./attachment.js";
import {
	attachmentRoutes,
	canonicalContextIdentity,
	Identity,
} from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import { children, isBoardEnvelope } from "./board/records.js";
import {
	contextRouteMatches,
	countContextTargets,
	sendContextRoute,
} from "./context-routing.js";
import type { AgentFleet, ConnectedMachine } from "./fleet/index.js";
import {
	describePeerSharing,
	peerReplyContext,
} from "./messages/peer-sharing.js";
import { NOTES_UNAVAILABLE } from "./notes-discovery.js";
import {
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import { resolveAncestryRoot } from "./spawn-ancestry.js";
import { MEMBER_ENTRY, type Member, SpawnContext } from "./spawn-context.js";
import type { PaneInfo } from "./types.js";

interface Routing {
	transport: "shepherdr";
	parent: string;
}
interface ContextEnvelope {
	operation: "context";
	request: SharedContextRequest;
	visited: string[];
	downstream?: boolean;
}

export class SharedAgentContext {
	private readonly fleet: AgentFleet;
	private readonly getService: () => ContextSharingService | undefined;
	private readonly board: AgentBoard;
	private readonly getRelationships: () =>
		| CodexAgentRelationshipService
		| undefined;
	private running = false;
	readonly attachment: AgentAttachment;
	readonly spawns: SpawnContext;

	constructor(
		pi: ExtensionAPI,
		fleet: AgentFleet,
		getService: () => ContextSharingService | undefined,
		board: AgentBoard,
		getRelationships: () => CodexAgentRelationshipService | undefined,
	) {
		this.fleet = fleet;
		this.getService = getService;
		this.board = board;
		this.getRelationships = getRelationships;
		const localMachine = () => fleet.localMachine();
		this.attachment = new AgentAttachment(pi, board, getService, localMachine);
		this.spawns = new SpawnContext(
			pi,
			getService,
			getRelationships,
			localMachine,
		);
		pi.on("before_agent_start", () => {
			this.running = true;
		});
		pi.on("agent_settled", () => {
			this.running = false;
		});
	}

	needsRelay(ctx: ExtensionContext, machine: string): boolean {
		if (children(ctx).some((child) => child.machine === machine)) return true;
		if (
			attachmentRoutes(ctx).some(
				(route) =>
					route.machine === machine &&
					((route.plan.context && !route.detached?.context) ||
						(route.plan.board && !route.detached?.board)),
			)
		)
			return true;
		const identity = this.getService()?.describe(ctx);
		if (!identity) return false;
		return ctx.sessionManager.getEntries().some((entry) => {
			if (entry.type !== "custom" || entry.customType !== MEMBER_ENTRY)
				return false;
			const child = entry.data as Partial<Member> | undefined;
			return (
				child?.machine === machine &&
				child.threadId === identity.threadId &&
				child.sessionId === identity.sessionId &&
				typeof child.sessionFile === "string" &&
				!!child.sessionFile &&
				typeof child.agentName === "string"
			);
		});
	}

	peerReplyContext(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		panel: PaneInfo,
		signal?: AbortSignal,
	): Promise<string> {
		return peerReplyContext(
			ctx,
			() => describePeerSharing(ctx, this.getService(), this.board),
			runtime,
			panel,
			signal,
		);
	}

	async handle(
		ctx: ExtensionContext,
		value: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (
			value &&
			typeof value === "object" &&
			"operation" in value &&
			value.operation === "agent-identity"
		)
			return { sessionId: ctx.sessionManager.getSessionId() };
		if (
			value &&
			typeof value === "object" &&
			"operation" in value &&
			value.operation === "peer-sharing"
		)
			return describePeerSharing(ctx, this.getService(), this.board);
		if (isBoardEnvelope(value)) return this.board.handle(ctx, value, signal);
		if (!value || typeof value !== "object")
			throw new Error("Invalid shared context request");
		if (
			"operation" in value &&
			(value.operation === "attach-inspect" ||
				value.operation === "attach-commit" ||
				value.operation === "attachment-export-notes" ||
				value.operation === "detach-commit")
		)
			return this.attachment.target.handle(ctx, value, signal);
		const service = this.getService();
		const identity = service?.describe(ctx);
		if (
			"operation" in value &&
			value.operation === "attachment-persisted-notes"
		) {
			const file = ctx.sessionManager.getSessionFile();
			if (
				!file ||
				!("identity" in value) ||
				!Check(Identity, value.identity) ||
				!isDeepStrictEqual(
					identity,
					canonicalContextIdentity(value.identity),
				) ||
				identity?.threadId !== ctx.sessionManager.getSessionId()
			)
				throw new Error("Invalid saved checkpoint owner");
			return requestContext(sessionContextPath(file), value, signal);
		}
		if ("operation" in value && value.operation === "bind") {
			if (!service || !identity) return null;
			return service.bind(ctx, "binding" in value ? value.binding : undefined);
		}
		if ("operation" in value && value.operation === "bind-relationship") {
			return (
				this.getRelationships()?.bind(
					ctx,
					"relationship" in value ? value.relationship : undefined,
				) ?? null
			);
		}
		if (!identity || !service) throw new Error(NOTES_UNAVAILABLE);
		if ("operation" in value && value.operation === "context-resolve")
			return countContextTargets(
				ctx,
				identity,
				value as Record<string, unknown>,
				this.fleet,
				signal,
			);
		const envelope = value as Partial<ContextEnvelope>;
		const request = envelope.request;
		if (
			envelope.operation !== "context" ||
			!request ||
			request.sessionId !== identity.sessionId ||
			typeof request.agentName !== "string" ||
			!Array.isArray(envelope.visited) ||
			envelope.visited.some((item) => typeof item !== "string") ||
			envelope.visited.length >= 64 ||
			envelope.visited.includes(identity.threadId)
		)
			throw new Error("Invalid shared context route or session family");
		const forwarded = {
			...envelope,
			visited: [...envelope.visited, identity.threadId],
		};
		const nativeTarget =
			/^\/[^/]+$/.test(request.agentName) && request.agentName !== "/root";
		const routing = identity.routing as Partial<Routing> | undefined;
		let resolved: Awaited<ReturnType<typeof contextRouteMatches>> | undefined;
		if (nativeTarget && !envelope.downstream) {
			if (
				routing?.transport === "shepherdr" &&
				typeof routing.parent === "string"
			)
				return requestContext(routing.parent, forwarded, signal);
			resolved = await contextRouteMatches(
				ctx,
				identity,
				request.agentName,
				[identity.threadId],
				this.fleet,
				signal,
			);
			const count = resolved.reduce(
				(total, match) => total + match.count,
				identity.agentName === request.agentName ? 1 : 0,
			);
			if (count > 1)
				throw new Error(
					`Multiple shared agents use ${request.agentName}; start sessions with distinct Pi IDs`,
				);
		}
		if (
			identity.agentName === request.agentName ||
			identity.storageAgentName === request.agentName ||
			(request.agentName === "/root" &&
				identity.threadId === identity.sessionId)
		) {
			if (!ctx.isIdle() && !this.running)
				throw new Error(
					"Context owner is changing branches; retry after it settles",
				);
			return service.execute(ctx, request, signal);
		}
		const attached = await this.attachment.routing.route(
			ctx,
			request,
			forwarded.visited,
			async (route, next) =>
				this.fleet
					.connected(route.machine)
					.client.requestContext(
						sessionContextPath(route.sessionFile),
						next,
						signal,
					) as Promise<SharedContextResult>,
			signal,
		);
		if (attached) return attached;
		const member = ctx.sessionManager.getEntries().findLast((entry) => {
			if (!request.agentName.startsWith("/root/")) return false;
			if (entry.type !== "custom" || entry.customType !== MEMBER_ENTRY)
				return false;
			const candidate = entry.data as Member;
			return (
				candidate?.threadId === identity.threadId &&
				candidate.sessionId === identity.sessionId &&
				typeof candidate.agentName === "string" &&
				(request.agentName === candidate.agentName ||
					request.agentName.startsWith(`${candidate.agentName}/`))
			);
		});
		if (member?.type === "custom") {
			const child = member.data as Member;
			if (
				typeof child.machine !== "string" ||
				typeof child.sessionFile !== "string" ||
				!child.sessionFile
			)
				throw new Error("Invalid saved shared context route");
			const runtime = this.fleet.connected(child.machine);
			return runtime.client.requestContext(
				sessionContextPath(child.sessionFile),
				forwarded,
				signal,
			);
		}
		if (
			!envelope.downstream &&
			routing?.transport === "shepherdr" &&
			typeof routing.parent === "string"
		)
			return requestContext(routing.parent, forwarded, signal);
		if (nativeTarget) {
			// Change direction only at the family owner. Descending never relays upstream.
			const visited = envelope.downstream
				? forwarded.visited
				: [identity.threadId];
			const matches =
				resolved ??
				(await contextRouteMatches(
					ctx,
					identity,
					request.agentName,
					visited,
					this.fleet,
					signal,
				));
			const count = matches.reduce((total, match) => total + match.count, 0);
			if (count > 1)
				throw new Error(
					`Multiple shared agents use ${request.agentName}; start sessions with distinct Pi IDs`,
				);
			const match = matches.find((candidate) => candidate.count === 1);
			if (match)
				return sendContextRoute(
					this.fleet,
					match.route,
					{
						operation: "context",
						request: { ...request, sessionId: match.route.sessionId },
						visited,
						downstream: true,
					},
					signal,
				);
		}
		throw new Error(
			`No shared context agent ${request.agentName} in this session family`,
		);
	}

	async resolveRoot(
		ctx: ExtensionContext,
		machine?: string,
		signal?: AbortSignal,
	) {
		return resolveAncestryRoot(ctx, this.fleet, machine, signal);
	}
}
