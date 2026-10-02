import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-codex-conversion/context-sharing";
import type { AgentBoard } from "./board/host.js";
import { isBoardEnvelope } from "./board/protocol.js";
import type { AgentFleet, ConnectedMachine } from "./fleet.js";
import { sessionPath } from "./herdr.js";
import {
	listenContext,
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import type { PaneInfo } from "./types.js";

const MEMBER_ENTRY = "herdr-context-child";
interface Member {
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
interface ContextEnvelope {
	operation: "context";
	request: SharedContextRequest;
	visited: string[];
}

export class SharedAgentContext {
	private readonly pi: ExtensionAPI;
	private readonly fleet: AgentFleet;
	private readonly getService: () => ContextSharingService | undefined;
	private readonly board: AgentBoard;
	private running = false;

	constructor(
		pi: ExtensionAPI,
		fleet: AgentFleet,
		getService: () => ContextSharingService | undefined,
		board: AgentBoard,
	) {
		this.pi = pi;
		this.fleet = fleet;
		this.getService = getService;
		this.board = board;
		pi.on("agent_start", () => {
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
		if (isBoardEnvelope(value)) return this.board.handle(ctx, value, signal);
		if (!value || typeof value !== "object")
			throw new Error("Invalid shared context request");
		const service = this.getService();
		const identity = service?.describe(ctx);
		if ("operation" in value && value.operation === "bind") {
			if (!service || !identity) return null;
			return service.bind(ctx, "binding" in value ? value.binding : undefined);
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
		const routing: Routing | undefined =
			parent.storage === "session"
				? {
						transport: "shepherdr",
						parent: runtime.local
							? sessionContextPath(parentFile)
							: runtime.client.contextRelayPath(),
					}
				: undefined;
		const { binding, adopt } = await service.createChild(ctx, {
			name,
			...(routing ? { routing } : {}),
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
						warning:
							"Spawned without shared context: the target needs Codex conversion with notes-based continuity",
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

export async function registerSharedAgentContext(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	board: AgentBoard,
): Promise<SharedAgentContext> {
	let api:
		| typeof import("@howaboua/pi-codex-conversion/context-sharing")
		| undefined;
	try {
		api = await import("@howaboua/pi-codex-conversion/context-sharing");
	} catch (error) {
		const failure = error as { code?: string; message?: string };
		const missing = failure.message?.match(
			/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
		)?.[1];
		const module = "@howaboua/pi-codex-conversion/context-sharing";
		const unavailable =
			((failure.code === "ERR_MODULE_NOT_FOUND" ||
				failure.code === "MODULE_NOT_FOUND") &&
				(missing === "@howaboua/pi-codex-conversion" ||
					missing === module ||
					missing?.endsWith(`/${module}`))) ||
			(failure.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" &&
				failure.message?.includes("@howaboua/pi-codex-conversion") &&
				failure.message.includes("./context-sharing"));
		if (!unavailable)
			throw new Error(
				"Update pi-codex-conversion to use shared agent context",
				{ cause: error },
			);
	}
	const connection = api?.connectCodexContextSharing(pi);
	const shared = new SharedAgentContext(
		pi,
		fleet,
		() => connection?.service,
		board,
	);
	let close: (() => Promise<void>) | undefined;
	let unregister: (() => void) | undefined;
	pi.on("session_start", async (_event, ctx) => {
		await close?.();
		close = undefined;
		unregister?.();
		unregister = connection?.service?.registerRouter(
			async (context, request, signal) =>
				shared.handle(
					context,
					{ operation: "context", request, visited: [] },
					signal,
				) as Promise<SharedContextResult>,
		);
		const file = ctx.sessionManager.getSessionFile();
		if (file)
			close = await listenContext(
				sessionContextPath(file),
				(request: unknown, signal: AbortSignal) =>
					shared.handle(ctx, request, signal),
			);
	});
	pi.on("session_shutdown", async () => {
		unregister?.();
		await close?.();
		connection?.dispose();
	});
	fleet.setContextRelay((ctx, request, signal) =>
		shared.handle(ctx, request, signal),
	);
	return shared;
}
