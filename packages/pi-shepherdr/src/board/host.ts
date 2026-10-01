import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentFleet, ConnectedMachine } from "../fleet.js";
import { sessionPath } from "../herdr.js";
import {
	requestContext,
	sessionContextPath,
} from "../remote/shepherdr-context.mjs";
import { executeArchive } from "./archive.js";
import {
	type BoardScope,
	readBoardConfig,
	writeBoardConfig,
} from "./config.js";
import {
	agentPath,
	type BoardParams,
	boardHelp,
	parseBoardRequest,
} from "./contract.js";
import {
	binding,
	children,
	members,
	parseBinding,
	rootBoardSetting,
	saveBinding,
	saveBoardSetting,
	saveChild,
	saveMember,
	sessionBoardSetting,
} from "./identity.js";
import { type BoardEnvelope, parseEnvelope } from "./protocol.js";
import { BoardTurns } from "./turns.js";

export class AgentBoard {
	private readonly pi: ExtensionAPI;
	private readonly fleet: AgentFleet;
	private readonly turns: BoardTurns;
	private refreshTools: (() => void) | undefined;
	private lastSetting: { sessionId: string; enabled: boolean } | undefined;
	private configError: string | undefined;
	constructor(pi: ExtensionAPI, fleet: AgentFleet) {
		this.pi = pi;
		this.fleet = fleet;
		this.turns = new BoardTurns(pi, (ctx, request) =>
			this.toOwner(ctx, request),
		);
		pi.on("session_start", (_event, ctx) => this.refresh(ctx));
		pi.on("before_agent_start", async (_event, ctx) => {
			// Reconcile resumed/offline children before tool/prompt preparation.
			const own = binding(ctx);
			if (own.upstream) {
				try {
					const result = await this.toOwner(ctx, {
						operation: "board-call",
						caller: own,
						params: { action: "help" },
						requestId: "status",
					});
					if (
						typeof result === "object" &&
						result !== null &&
						"enabled" in result &&
						typeof result.enabled === "boolean" &&
						result.enabled !== own.enabled
					)
						saveBinding(pi, { ...own, enabled: result.enabled });
				} catch (error) {
					if (own.enabled)
						ctx.ui.notify(
							`Board owner unavailable: ${String(error)}`,
							"warning",
						);
				}
			}
			await this.refresh(ctx);
		});
	}
	setToolRefresh(refresh: () => void) {
		this.refreshTools = refresh;
	}
	enabled(ctx: ExtensionContext | undefined) {
		return ctx ? binding(ctx).enabled : false;
	}
	private async refresh(ctx: ExtensionContext) {
		const own = binding(ctx);
		const setting = own.upstream ? undefined : rootBoardSetting(ctx);
		if (setting?.error && setting.error !== this.configError)
			ctx.ui.notify(`Board disabled: ${setting.error}`, "error");
		this.configError = setting?.error;
		const active = this.pi.getActiveTools().filter((name) => name !== "board");
		if (own.enabled) active.push("board");
		this.pi.setActiveTools(active);
		this.refreshTools?.();
		if (!own.enabled) this.turns.active.clear();
		const changed =
			this.lastSetting?.sessionId !== own.sessionId ||
			this.lastSetting.enabled !== own.enabled;
		this.lastSetting = { sessionId: own.sessionId, enabled: own.enabled };
		if (changed && !own.upstream) await this.propagateEnabled(ctx, own.enabled);
	}
	settings(ctx: ExtensionContext) {
		const own = binding(ctx);
		if (own.upstream)
			throw new Error("Change the board setting in the owning root session");
		return {
			...readBoardConfig(own.ownerFolder),
			session: sessionBoardSetting(ctx),
		};
	}
	async setSetting(
		ctx: ExtensionContext,
		scope: BoardScope,
		enabled: boolean | undefined,
	) {
		if (!ctx.isIdle())
			throw new Error("Change the board setting after this session settles");
		const own = binding(ctx);
		if (own.upstream)
			throw new Error("Change the board setting in the owning root session");
		if (scope === "session") saveBoardSetting(this.pi, ctx, enabled);
		else writeBoardConfig(own.ownerFolder, scope, enabled);
		await this.refresh(ctx);
	}
	status(ctx: ExtensionContext) {
		const own = binding(ctx);
		const setting = own.upstream ? undefined : rootBoardSetting(ctx);
		return `Board ${own.enabled ? "on" : "off"} (${setting?.source ?? "inherited from owner"}). ${own.boardId}\nArchive: ${own.databasePath}${setting?.error ? `\n${setting.error}` : ""}`;
	}
	async execute(ctx: ExtensionContext, input: unknown, requestId: string) {
		const params = parseBoardRequest(input);
		const caller = binding(ctx);
		if (!caller.upstream) {
			const setting = rootBoardSetting(ctx);
			if (setting.error) throw new Error(setting.error);
		}
		if (!caller.enabled)
			throw new Error(
				"Board is off; the user can enable it with /herdr board on",
			);
		return this.toOwner(ctx, {
			operation: "board-call",
			caller,
			params,
			requestId,
		});
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
				await this.toOwner(ctx, {
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
	async handle(
		ctx: ExtensionContext,
		value: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const request = parseEnvelope(value);
		const own = binding(ctx);
		if (request.operation === "board-bind") {
			if (
				!ctx.isIdle() ||
				ctx.sessionManager
					.getEntries()
					.some(
						(entry) =>
							(entry.type === "message" &&
								["user", "assistant"].includes(entry.message.role)) ||
							(entry.type === "custom" &&
								entry.customType === "shepherdr-board-binding"),
					)
			)
				throw new Error(
					"Bind board identity only in a fresh idle child before its first task",
				);
			const adopted = { ...request.binding, sessionId: own.sessionId };
			saveBinding(this.pi, adopted);
			await this.refresh(ctx);
			return adopted;
		}
		if (request.operation === "board-enabled") {
			if (!own.upstream || request.boardId !== own.boardId)
				throw new Error("Invalid board setting route");
			saveBinding(this.pi, { ...own, enabled: request.enabled });
			await this.refresh(ctx);
			await this.propagateEnabled(ctx, request.enabled);
			return true;
		}
		if (request.operation === "board-notify") {
			if (!own.enabled || request.boardId !== own.boardId) return false;
			if (request.target === own.agentName) return this.turns.deliver(request);
			return this.routeNotice(ctx, request, signal);
		}
		return this.toOwner(ctx, request, signal);
	}
	private async toOwner(
		ctx: ExtensionContext,
		request: BoardEnvelope,
		signal?: AbortSignal,
	): Promise<unknown> {
		const own = binding(ctx);
		if (own.upstream) {
			try {
				return await requestContext(own.upstream, request, signal);
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.startsWith("Shared context response was lost")
				)
					throw new Error(
						"Board response lost; a mutation may have completed. Read the channel/thread before retrying",
						{ cause: error },
					);
				if (
					error instanceof Error &&
					error.message.startsWith("Shared context owner is unavailable")
				)
					throw new Error(
						"Board owner unavailable; resume its Pi session and reconnect its machine",
						{ cause: error },
					);
				throw error;
			}
		}
		if (!("caller" in request)) throw new Error("Invalid board owner request");
		const directory = members(ctx);
		const caller = directory.find(
			(member) =>
				member.sessionId === request.caller.sessionId &&
				member.agentName === request.caller.agentName,
		);
		if (
			!caller ||
			request.caller.boardId !== own.boardId ||
			request.caller.databasePath !== own.databasePath
		)
			throw new Error("Caller not bound to this board");
		if (request.operation === "board-register") {
			const member = request.member;
			if (
				member.boardId !== own.boardId ||
				member.databasePath !== own.databasePath ||
				member.rootSessionId !== own.rootSessionId ||
				!member.agentName.startsWith(`${caller.agentName}/`)
			)
				throw new Error("Invalid board member registration");
			if (
				directory.some(
					(entry) =>
						entry.agentName === member.agentName ||
						entry.sessionId === member.sessionId,
				)
			)
				throw new Error("Board member already bound");
			saveMember(this.pi, member);
			return true;
		}
		if (request.operation === "board-active") {
			if (own.enabled) this.turns.register(caller, request);
			return true;
		}
		if (request.operation !== "board-call")
			throw new Error("Invalid board owner operation");
		const params = parseBoardRequest(request.params);
		if (params.action === "help") return { ...boardHelp, enabled: own.enabled };
		if (!own.enabled)
			throw new Error(
				"Board is off; the user can enable it with /herdr board on",
			);
		const prepared: BoardParams =
			params.author === undefined
				? params
				: { ...params, author: agentPath(params.author, caller.agentName) };
		const active = new Map(this.turns.active);
		const result = await executeArchive(
			{ ...caller, enabled: own.enabled },
			directory.map((member) => member.agentName),
			prepared,
			request.requestId,
		);
		if ("notice" in result && result.notice) {
			for (let start = 0; start < result.recipients.length; start += 16) {
				await Promise.all(
					result.recipients.slice(start, start + 16).map(async (target) => {
						const turn = active.get(target);
						if (!turn) return;
						try {
							await this.handle(
								ctx,
								{
									operation: "board-notify",
									boardId: own.boardId,
									target,
									...turn,
									notice: result.notice,
								},
								AbortSignal.timeout(750),
							);
						} catch {
							/* Committed posts succeed even when a running turn stops accepting. */
						}
					}),
				);
			}
		}
		return result.value;
	}
	private async routeNotice(
		ctx: ExtensionContext,
		request: Extract<BoardEnvelope, { operation: "board-notify" }>,
		signal?: AbortSignal,
	) {
		const child = children(ctx).find(
			(entry) =>
				request.target === entry.binding.agentName ||
				request.target.startsWith(`${entry.binding.agentName}/`),
		);
		if (!child) return false;
		return this.fleet
			.connected(child.machine)
			.client.requestContext(
				sessionContextPath(child.sessionFile),
				request,
				signal,
			);
	}
	private async propagateEnabled(ctx: ExtensionContext, enabled: boolean) {
		await Promise.all(
			children(ctx).map(async (child) => {
				try {
					await this.fleet.connected(child.machine).client.requestContext(
						sessionContextPath(child.sessionFile),
						{
							operation: "board-enabled",
							boardId: binding(ctx).boardId,
							enabled,
						},
						AbortSignal.timeout(750),
					);
				} catch {
					/* Resumed children reconcile with their owner before the next user turn. */
				}
			}),
		);
	}
}
