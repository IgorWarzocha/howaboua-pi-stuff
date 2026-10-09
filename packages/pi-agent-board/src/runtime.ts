import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	recordBoardActivityMarker,
	registerBoardActivityRenderer,
} from "./activity.js";
import { executeArchive, readSubscribedUpdates } from "./archive.js";
import { BoardAwareness } from "./awareness.js";
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
import { initializeDelivery, isMissingOptionalModule } from "./delivery.js";
import {
	binding,
	members,
	rootBoardSetting,
	saveBinding,
	saveBoardSetting,
	sessionBoardSetting,
	setBoardDefault,
} from "./identity.js";
import type { BoardAdapter } from "./integration.js";
import { type BoardEnvelope, parseEnvelope } from "./protocol.js";
import { createBoardTool } from "./tool.js";
import { BoardTurns } from "./turns.js";

export class BoardRuntime {
	private readonly listeners = new Set<() => void>();
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private changed() {
		for (const listener of this.listeners) listener();
	}
	private readonly pi: ExtensionAPI;
	private adapter: BoardAdapter | undefined;
	standalone = false;
	private readonly turns: BoardTurns;
	private readonly awareness: BoardAwareness;
	private refreshTools: (() => void) | undefined;
	private lastSetting: { sessionId: string; enabled: boolean } | undefined;
	private configError: string | undefined;
	private availabilityWarning: string | undefined;
	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		const availability = (ctx: ExtensionContext, error?: unknown) =>
			this.reportAvailability(ctx, error);
		this.awareness = new BoardAwareness(
			pi,
			(ctx) => this.population(ctx),
			availability,
			() => this.adapter?.briefing,
		);
		this.turns = new BoardTurns(
			pi,
			(ctx, request) => this.toOwner(ctx, request),
			availability,
			(ctx, ids) => this.awareness.markSeen(ctx, ids),
		);
		pi.on("session_start", (_event, ctx) => {
			this.availabilityWarning = undefined;
			setBoardDefault(ctx, this.standalone);
			return this.refresh(ctx);
		});
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
					availability(ctx);
					if (
						typeof result === "object" &&
						result !== null &&
						"enabled" in result &&
						typeof result.enabled === "boolean" &&
						result.enabled !== own.enabled
					)
						saveBinding(pi, { ...own, enabled: result.enabled });
				} catch (error) {
					if (own.enabled) availability(ctx, error);
				}
			}
			await this.refresh(ctx);
			if (!this.adapter) {
				const catchup = await this.promptCatchup(ctx);
				catchup.accepted();
				if (catchup.content)
					return {
						message: {
							customType: "shepherdr-board-catchup",
							content: catchup.content.trim(),
							display: false,
						},
					};
			}
		});
	}
	private reportAvailability(ctx: ExtensionContext, error?: unknown): void {
		const own = binding(ctx);
		if (error === undefined || !own.enabled) {
			this.availabilityWarning = undefined;
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const key = JSON.stringify([
			own.sessionId,
			own.boardId,
			own.upstream,
			message,
		]);
		if (this.availabilityWarning === key) return;
		this.availabilityWarning = key;
		ctx.ui.notify(`Board unavailable: ${message}`, "warning");
	}
	setToolRefresh(refresh: () => void) {
		this.refreshTools = refresh;
	}
	private async population(ctx: ExtensionContext) {
		const own = binding(ctx);
		if (own.upstream) {
			const status = await this.toOwner(
				ctx,
				{
					operation: "board-call",
					caller: own,
					params: { action: "help" },
					requestId: "briefing-status",
				},
				ctx.signal,
			);
			if (
				!status ||
				typeof status !== "object" ||
				!("enabled" in status) ||
				typeof status.enabled !== "boolean"
			)
				throw new Error("Board status unavailable");
			if (status.enabled !== own.enabled) {
				saveBinding(this.pi, { ...own, enabled: status.enabled });
				await this.refresh(ctx);
			}
			if (!status.enabled) return;
		}
		return this.execute(
			ctx,
			{ action: "search_posts", limit: 1, max_chars_per_post: 1 },
			"briefing",
		);
	}
	enabled(ctx: ExtensionContext | undefined) {
		return ctx ? binding(ctx).enabled : false;
	}
	async promptCatchup(
		ctx: ExtensionContext,
	): Promise<{ content: string; accepted: () => void }> {
		const empty = { content: "", accepted: () => {} };
		const own = binding(ctx);
		if (!own.enabled) return empty;
		try {
			const result = await this.toOwner(ctx, {
				operation: "board-catchup",
				caller: own,
				seen: this.awareness.seen(ctx),
			});
			if (
				!Array.isArray(result) ||
				!result.every(
					(post) =>
						post &&
						typeof post.message_id === "string" &&
						typeof post.thread_id === "string",
				)
			)
				throw new Error("Invalid board catch-up response");
			if (
				!binding(ctx).enabled ||
				binding(ctx).sessionId !== own.sessionId ||
				binding(ctx).boardId !== own.boardId ||
				binding(ctx).agentName !== own.agentName
			)
				return empty;
			this.reportAvailability(ctx);
			const nested = this.pi
				.getActiveTools()
				.some((tool) => ["exec", "code", "notebook"].includes(tool));
			return {
				content: result.length
					? `\n\nBoard updates: ${[
							...new Set(result.map((post) => post.thread_id)),
						]
							.map((thread_id) => {
								const args = JSON.stringify({
									action: "read_thread",
									thread_id,
								});
								return nested ? `await tools.board(${args})` : `board ${args}`;
							})
							.join("; ")}`
					: "",
				accepted: () =>
					this.awareness.markSeen(
						ctx,
						result.map((post) => post.message_id),
					),
			};
		} catch (error) {
			this.reportAvailability(ctx, error);
			return empty;
		}
	}
	async refresh(ctx: ExtensionContext) {
		const own = binding(ctx);
		this.awareness.refresh(ctx);
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
		this.changed();
		if (changed && !own.upstream) await this.propagateEnabled(ctx, own.enabled);
	}
	settings(ctx: ExtensionContext) {
		const own = binding(ctx);
		if (own.upstream)
			throw new Error("Change the board setting in the owning root session");
		return {
			...readBoardConfig(own.ownerFolder, this.standalone),
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
	status(ctx: ExtensionContext, includeArchive = true) {
		const own = binding(ctx);
		const setting = own.upstream ? undefined : rootBoardSetting(ctx);
		return `Board ${own.enabled ? "on" : "off"} (${setting?.source ?? "inherited from owner"})${includeArchive ? `. ${own.boardId}\nArchive: ${own.databasePath}` : ""}${setting?.error ? `\n${setting.error}` : ""}`;
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
				"Board is off; the user can enable it in /board on or /herdr → Settings",
			);
		const value = await this.toOwner(
			ctx,
			{
				operation: "board-call",
				caller,
				params,
				requestId,
			},
			ctx.signal,
		);
		if (params.action === "read_thread" || params.action === "read_post")
			this.awareness.markRead(ctx, value);
		try {
			recordBoardActivityMarker(this.pi, ctx, params, value, requestId);
		} catch {
			// Presentation failure must not turn a successful operation into a retry.
			ctx.ui.notify(
				"Board action succeeded. Its history notice is unavailable. Do not repeat writes just to restore the notice.",
				"warning",
			);
		}
		return value;
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
	async toOwner(
		ctx: ExtensionContext,
		request: BoardEnvelope,
		signal?: AbortSignal,
	): Promise<unknown> {
		const own = binding(ctx);
		if (own.upstream) {
			try {
				const result = await this.requireAdapter().request(
					own.upstream,
					request,
					signal,
				);
				this.reportAvailability(ctx);
				return result;
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
		if (
			request.operation === "board-unregister" ||
			request.operation === "board-register"
		)
			return this.requireAdapter().commitDirectory(
				own,
				directory,
				caller,
				request,
			);
		if (request.operation === "board-active") {
			if (own.enabled) this.turns.register(caller, request);
			return true;
		}
		if (request.operation === "board-catchup")
			return own.enabled ? readSubscribedUpdates(caller, request.seen) : [];
		if (request.operation !== "board-call")
			throw new Error("Invalid board owner operation");
		const params = parseBoardRequest(request.params);
		if (params.action === "help")
			return {
				...boardHelp,
				rules: this.adapter
					? boardHelp.rules
					: {
							...boardHelp.rules,
							agents:
								"Absolute /root/... or child path relative to you; notices require registered members",
						},
				enabled: own.enabled,
			};
		if (!own.enabled)
			throw new Error(
				"Board is off; the user can enable it in /board on or /herdr → Settings",
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
		return this.requireAdapter().routeNotice(ctx, request, signal);
	}
	private async propagateEnabled(ctx: ExtensionContext, enabled: boolean) {
		await this.adapter?.propagateEnabled(ctx, enabled);
	}
	attach(adapter: BoardAdapter) {
		if (this.adapter) throw new Error("Board integration already attached");
		this.adapter = adapter;
	}
	private requireAdapter() {
		if (!this.adapter)
			throw new Error(
				"Board member route unavailable; load the extension that manages this session's board membership",
			);
		return this.adapter;
	}
	get active() {
		return this.turns.active;
	}
}

const CLAIM = "@howaboua/pi-agent-board.owner/v1";
interface OwnerClaim {
	runtime: Promise<BoardRuntime>;
	standalone: boolean;
}

/** Both entrypoints claim the same engine through Pi's shared extension bus. */
export async function acquireBoard(
	pi: ExtensionAPI,
	options: { standalone?: boolean } = {},
): Promise<BoardRuntime> {
	let claim: OwnerClaim | undefined;
	pi.events.emit(CLAIM, {
		accept(value: OwnerClaim) {
			claim = value;
		},
	});
	if (!claim) {
		const created: OwnerClaim = {
			standalone: Boolean(options.standalone),
			runtime: createRuntime(pi),
		};
		claim = created;
		const stop = pi.events.on(CLAIM, (value) => {
			if (
				value &&
				typeof value === "object" &&
				"accept" in value &&
				typeof value.accept === "function"
			)
				value.accept(created);
		});
		pi.on("session_shutdown", stop);
	}
	if (options.standalone) claim.standalone = true;
	const runtime = await claim.runtime;
	runtime.standalone = claim.standalone;
	return runtime;
}

async function createRuntime(pi: ExtensionAPI) {
	await initializeDelivery();
	const runtime = new BoardRuntime(pi);
	const tool = createBoardTool(runtime);
	pi.registerTool(tool);
	registerBoardActivityRenderer(pi);
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() => [
				adaptToolForCodeMode(tool, {
					prepareInput: (input) =>
						input === undefined || input === null ? {} : input,
					usage: "await tools.board() // Shared discussion archive",
				}),
			],
			{ isActive: (ctx) => runtime.enabled(ctx) },
		);
		runtime.setToolRefresh(() => registration.refresh());
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (!isMissingOptionalModule(error, "code-mode")) throw error;
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
		)
			throw new Error(
				"Update Codex Conversion to use its Code and Notebook board tools",
				{ cause: error },
			);
	}
	return runtime;
}
