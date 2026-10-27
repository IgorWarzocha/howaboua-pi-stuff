import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { binding, isBoardEnvelope } from "@howaboua/pi-agent-board/integration";
import type { CodexAgentRelationshipService } from "@howaboua/pi-codex-conversion/agent-relationship";
import type {
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-notes-compaction/context-sharing";
import { Check } from "typebox/value";
import { AgentAttachment } from "./attachment.js";
import { Identity } from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet/index.js";
import { sessionPath } from "./herdr.js";
import {
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import { MEMBER_ENTRY, type Member, SpawnContext } from "./spawn-context.js";

interface Routing {
	transport: "shepherdr";
	parent: string;
}
interface ContextEnvelope {
	operation: "context";
	request: SharedContextRequest;
	visited: string[];
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
		this.attachment = new AgentAttachment(pi, board, getService);
		this.spawns = new SpawnContext(pi, getService, getRelationships);
		pi.on("before_agent_start", () => {
			this.running = true;
		});
		pi.on("agent_settled", () => {
			this.running = false;
		});
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
			value.operation === "agent-root"
		) {
			const own = binding(ctx);
			const identity = this.getService()?.describe(ctx);
			if (
				!("scope" in value) ||
				(value.scope !== "board" && value.scope !== "context")
			)
				throw new Error("Invalid /root family");
			const family =
				value.scope === "board" ? own.rootSessionId : identity?.sessionId;
			if (
				!("family" in value) ||
				value.family !== family ||
				!("visited" in value) ||
				!Array.isArray(value.visited) ||
				value.visited.some((item) => typeof item !== "string") ||
				value.visited.length >= 64 ||
				value.visited.includes(ctx.sessionManager.getSessionId())
			)
				throw new Error("No live /root in this agent family");
			const routing = identity?.routing as Partial<Routing> | undefined;
			const upstream =
				value.scope === "board"
					? own.upstream
					: identity?.agentName !== "/root" &&
							routing?.transport === "shepherdr"
						? routing.parent
						: undefined;
			if (upstream)
				return requestContext(
					upstream,
					{
						...value,
						visited: [...value.visited, ctx.sessionManager.getSessionId()],
					},
					signal,
				);
			if (
				(value.scope === "board" ? own.agentName : identity?.agentName) !==
				"/root"
			)
				throw new Error("No live /root in this agent family");
			return {
				...(await this.fleet.connected().client.machineIdentity()),
				sessionFile: ctx.sessionManager.getSessionFile(),
			};
		}
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
				!isDeepStrictEqual(identity, value.identity) ||
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
		if (!identity || !service)
			throw new Error("Context sharing is unavailable in this session");
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
		if (identity.agentName === request.agentName) {
			if (!ctx.isIdle() && !this.running)
				throw new Error(
					"Context owner is changing branches; retry after it settles",
				);
			return service.execute(ctx, request, signal);
		}
		const forwarded = {
			...envelope,
			visited: [...envelope.visited, identity.threadId],
		};
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
		const routing = identity.routing as Partial<Routing> | undefined;
		if (
			routing?.transport === "shepherdr" &&
			typeof routing.parent === "string"
		)
			return requestContext(routing.parent, forwarded, signal);
		throw new Error(
			`No shared context agent ${request.agentName} in this session family`,
		);
	}

	async resolveRoot(
		ctx: ExtensionContext,
		machine?: string,
		signal?: AbortSignal,
	) {
		const own = binding(ctx);
		const identity = this.getService()?.describe(ctx);
		const scope = own.upstream || !identity ? "board" : "context";
		const family = scope === "board" ? own.rootSessionId : identity?.sessionId;
		let result: unknown;
		try {
			result = await this.handle(
				ctx,
				{ operation: "agent-root", scope, family, visited: [] },
				signal,
			);
		} catch (error) {
			signal?.throwIfAborted();
			throw new Error(
				"No live /root in this agent family; use find for an exact target",
				{ cause: error },
			);
		}
		if (
			!result ||
			typeof result !== "object" ||
			!("host" in result) ||
			!("session" in result) ||
			!("sessionFile" in result) ||
			typeof result.sessionFile !== "string"
		)
			throw new Error("No live /root in this agent family");
		const matches = [];
		for (const entry of await this.fleet.snapshots(machine)) {
			if (!entry.snapshot) continue;
			const runtime = this.fleet.connected(entry.id);
			const identity = await runtime.client.machineIdentity();
			if (identity.host !== result.host || identity.session !== result.session)
				continue;
			for (const agent of entry.snapshot.agents) {
				if (agent.agent === "pi" && sessionPath(agent) === result.sessionFile)
					matches.push({ runtime, target: agent.pane_id });
			}
		}
		if (matches.length !== 1)
			throw new Error(
				"No unique live /root in this agent family; use find for an exact target",
			);
		return matches[0]!;
	}
}
