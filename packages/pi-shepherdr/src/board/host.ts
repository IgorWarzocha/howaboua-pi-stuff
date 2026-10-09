import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type BoardScope,
	binding,
	children,
	parseBinding,
	saveBinding,
	saveChild,
} from "@howaboua/pi-agent-board/integration";
import { acquireBoard } from "@howaboua/pi-agent-board/runtime";
import type { AgentFleet, ConnectedMachine } from "../fleet.js";
import { sessionPath } from "../herdr.js";
import { boardBriefing } from "../messages.js";
import {
	requestContext,
	sessionContextPath,
} from "../remote/shepherdr-context.mjs";
import { BoardMembership } from "./membership.js";

/** Private fleet adapter: spawning and attachment policy never enters the shared engine. */
export class AgentBoard {
	readonly membership: BoardMembership;
	private readonly pi: ExtensionAPI;
	private readonly runtime: Awaited<ReturnType<typeof acquireBoard>>;
	private constructor(
		pi: ExtensionAPI,
		runtime: Awaited<ReturnType<typeof acquireBoard>>,
		fleet: AgentFleet,
	) {
		this.pi = pi;
		this.runtime = runtime;
		this.membership = new BoardMembership(
			pi,
			(ctx, request) => runtime.toOwner(ctx, request),
			runtime.active,
		);
		runtime.attach({
			briefing: boardBriefing,
			request: requestContext,
			commitDirectory: (own, directory, caller, request) =>
				this.membership.commitDirectory(own, directory, caller, request),
			routeNotice: (ctx, request, signal) => {
				const child = children(ctx).find(
					(entry) =>
						request.target === entry.binding.agentName ||
						request.target.startsWith(`${entry.binding.agentName}/`),
				);
				if (!child) return Promise.resolve(false);
				return fleet
					.connected(child.machine)
					.client.requestContext(
						sessionContextPath(child.sessionFile),
						request,
						signal,
					);
			},
			propagateEnabled: async (ctx, enabled) => {
				await Promise.all(
					children(ctx).map(async (child) => {
						try {
							await fleet.connected(child.machine).client.requestContext(
								sessionContextPath(child.sessionFile),
								{
									operation: "board-enabled",
									boardId: binding(ctx).boardId,
									enabled,
								},
								AbortSignal.timeout(750),
							);
						} catch {
							/* Resumed children reconcile before their next user turn. */
						}
					}),
				);
			},
		});
	}
	static async create(pi: ExtensionAPI, fleet: AgentFleet) {
		return new AgentBoard(pi, await acquireBoard(pi), fleet);
	}
	subscribe(listener: () => void) {
		return this.runtime.subscribe(listener);
	}
	enabled(ctx: ExtensionContext | undefined) {
		return this.runtime.enabled(ctx);
	}
	refresh(ctx: ExtensionContext) {
		return this.runtime.refresh(ctx);
	}
	settings(ctx: ExtensionContext) {
		return this.runtime.settings(ctx);
	}
	setSetting(
		ctx: ExtensionContext,
		scope: BoardScope,
		enabled: boolean | undefined,
	) {
		return this.runtime.setSetting(ctx, scope, enabled);
	}
	status(ctx: ExtensionContext, includeArchive = true) {
		return this.runtime.status(ctx, includeArchive);
	}
	execute(ctx: ExtensionContext, input: unknown, requestId: string) {
		return this.runtime.execute(ctx, input, requestId);
	}
	handle(ctx: ExtensionContext, value: unknown, signal?: AbortSignal) {
		return this.runtime.handle(ctx, value, signal);
	}
	promptCatchup(ctx: ExtensionContext) {
		return this.runtime.promptCatchup(ctx);
	}
	async prepare(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		name: string,
		args: readonly string[],
	) {
		const own = binding(ctx);
		if (!own.enabled) return undefined;
		if (
			args.some((arg) =>
				/^(?:--(?:session(?:-id)?|continue|resume|no-session|fork)(?:=|$)|-[cr]$)/.test(
					arg,
				),
			)
		)
			throw new Error(
				"Board child binding requires a fresh saved Pi session; use assign for existing agents",
			);
		const file = ctx.sessionManager.getSessionFile();
		if (!file)
			throw new Error(
				"Board child binding requires a saved controller session",
			);
		const segment =
			name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "agent";
		const agentName = `${own.agentName}/${segment}-${randomUUID()}`;
		const upstream = runtime.local
			? sessionContextPath(file)
			: runtime.client.contextRelayPath();
		// Persist only session identity/routes, never an empty archive or board.
		saveBinding(this.pi, own);
		return {
			accept: async (agent: Parameters<typeof sessionPath>[0]) => {
				const sessionFile = sessionPath(agent);
				if (!sessionFile)
					throw new Error("Spawned agent has no native Pi session path");
				const prepared = { ...own, agentName, upstream };
				const result = await runtime.client.requestContext(
					sessionContextPath(sessionFile),
					{ operation: "board-bind", binding: prepared },
				);
				const adopted = parseBinding(result);
				if (
					adopted.boardId !== own.boardId ||
					adopted.databasePath !== own.databasePath ||
					adopted.agentName !== agentName ||
					adopted.rootSessionId !== own.rootSessionId ||
					adopted.upstream !== upstream ||
					adopted.sessionId === own.sessionId
				)
					throw new Error("Spawned agent did not adopt its board binding");
				if (ctx.sessionManager.getSessionId() !== own.sessionId)
					throw new Error("Controller session changed during board binding");
				await this.runtime.toOwner(ctx, {
					operation: "board-register",
					caller: own,
					member: adopted,
				});
				saveChild(this.pi, {
					parentSessionId: own.sessionId,
					binding: adopted,
					machine: runtime.machine,
					sessionFile,
				});
				return adopted.agentName;
			},
		};
	}
}
