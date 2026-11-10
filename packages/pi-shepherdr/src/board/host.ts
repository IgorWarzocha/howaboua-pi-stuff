import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BoardRuntime } from "@howaboua/pi-agent-comms/runtime";
import { sessionPath } from "../core/agents.js";
import type { AgentFleet, ConnectedMachine } from "../fleet/index.js";
import { boardMigrationWarning } from "../messages/guidance.js";
import {
	requestContext,
	sessionContextPath,
} from "../remote/shepherdr-context.mjs";
import { discoverBoard } from "./discovery.js";
import { BoardMembership } from "./membership.js";
import {
	binding,
	children,
	parseBinding,
	saveBinding,
	saveChild,
} from "./records.js";

/** Private fleet adapter: spawning and attachment policy never enters the shared engine. */
export class AgentBoard {
	readonly membership: BoardMembership;
	private readonly pi: ExtensionAPI;
	private runtime: BoardRuntime | undefined;
	private failure: Error | undefined;
	private context: ExtensionContext | undefined;
	private constructor(pi: ExtensionAPI, fleet: AgentFleet) {
		this.pi = pi;
		this.membership = new BoardMembership(
			pi,
			(ctx, request) => this.owner().toOwner(ctx, request),
			() => this.owner().active,
			(ctx) => this.binding(ctx),
		);
		const warned = new Set<string>();
		pi.on("session_start", (_event, ctx) => {
			this.context = ctx;
			const sessionId = ctx.sessionManager.getSessionId();
			if (this.failure) ctx.ui.notify(this.failure.message, "error");
			if (this.runtime || warned.has(sessionId)) return;
			try {
				if (binding(ctx).enabled) {
					warned.add(sessionId);
					ctx.ui.notify(boardMigrationWarning(), "warning");
				}
			} catch (error) {
				ctx.ui.notify(
					`Could not restore saved board settings: ${String(error)}`,
					"error",
				);
			}
		});
		pi.on("session_shutdown", () => {
			this.context = undefined;
		});
		discoverBoard(
			pi,
			(runtime) => {
				runtime.attach({
					request: requestContext,
					commitDirectory: (own, directory, caller, request) =>
						this.membership.commitDirectory(own, directory, caller, request),
					routeNotice: async (ctx, request, signal) => {
						const next = request.route?.[0] ?? request.sessionId;
						const child = children(ctx).find(
							(entry) => entry.binding.sessionId === next,
						);
						if (!child) return false;
						return fleet.connected(child.machine).client.requestContext(
							sessionContextPath(child.sessionFile),
							{
								...request,
								...(request.route ? { route: request.route.slice(1) } : {}),
							},
							signal,
						);
					},
					propagateEnabled: async (ctx, enabled) => {
						let boardId: string | undefined;
						await Promise.all(
							children(ctx).map(async (child) => {
								try {
									await fleet.connected(child.machine).client.requestContext(
										sessionContextPath(child.sessionFile),
										{
											operation: "board-enabled",
											boardId: (boardId ??= this.binding(ctx).boardId),
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
				this.runtime = runtime;
				this.failure = undefined;
			},
			(error) => {
				this.failure = error;
				this.context?.ui.notify(error.message, "error");
			},
		);
	}
	static create(pi: ExtensionAPI, fleet: AgentFleet) {
		return new AgentBoard(pi, fleet);
	}
	private owner() {
		if (this.failure) throw this.failure;
		if (!this.runtime)
			throw new Error(
				"Shared boards are unavailable. Load Agent Comms or Agent Board and reload Pi. Other agent operations remain available.",
			);
		return this.runtime;
	}
	requireAvailable() {
		this.owner();
	}
	enabled(ctx: ExtensionContext | undefined) {
		return this.runtime?.enabled(ctx) ?? false;
	}
	binding(ctx: ExtensionContext) {
		const own = binding(ctx);
		// Configuration/defaults belong to the loaded owner, not this protocol reader.
		return own.upstream ? own : { ...own, enabled: this.enabled(ctx) };
	}
	refresh(ctx: ExtensionContext) {
		return this.owner().refresh(ctx);
	}
	execute(ctx: ExtensionContext, input: unknown, requestId: string) {
		return this.owner().execute(ctx, input, requestId);
	}
	handle(ctx: ExtensionContext, value: unknown, signal?: AbortSignal) {
		// Only a missing owner can decline a fresh bind without mutating state.
		if (
			!this.runtime &&
			!this.failure &&
			value &&
			typeof value === "object" &&
			"operation" in value &&
			value.operation === "board-bind"
		)
			return null;
		return this.owner().handle(ctx, value, signal);
	}
	promptCatchup(ctx: ExtensionContext) {
		return (
			this.runtime?.promptCatchup(ctx) ??
			Promise.resolve({ content: "", accepted() {} })
		);
	}
	async prepare(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		_name: string,
		args: readonly string[],
	) {
		if (!this.enabled(ctx)) return undefined;
		const own = { ...this.binding(ctx), enabled: true };
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
		await runtime.prepareSharing();
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
				const prepared = { ...own, upstream };
				const result = await runtime.client.requestContext(
					sessionContextPath(sessionFile),
					{ operation: "board-bind", binding: prepared },
				);
				if (result === null)
					return {
						warning:
							"Spawned without shared Board: the target needs Agent Board or Agent Comms",
					};
				const adopted = parseBinding(result);
				if (
					adopted.boardId !== own.boardId ||
					adopted.databasePath !== own.databasePath ||
					adopted.agentName !== `/${adopted.sessionId}` ||
					adopted.parentSessionId !== own.sessionId ||
					adopted.rootSessionId !== own.rootSessionId ||
					adopted.upstream !== upstream ||
					adopted.sessionId === own.sessionId
				)
					throw new Error("Spawned agent did not adopt its board binding");
				if (ctx.sessionManager.getSessionId() !== own.sessionId)
					throw new Error("Controller session changed during board binding");
				await this.owner().toOwner(ctx, {
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
				return { agentName: adopted.agentName };
			},
		};
	}
}
