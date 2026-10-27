import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { recordBoardActivityMarker } from "../activity.js";
import { BoardAwareness } from "../awareness.js";
import {
	type BoardScope,
	writeBoardConfig,
	writeBoardSummaryAutomatic,
} from "../config.js";
import { gptBoardHelp, parseBoardRequest } from "../contract.js";
import { preparePolicyMessage } from "../delivery.js";
import {
	binding,
	rootBoardSetting,
	saveBinding,
	saveBoardSetting,
	setBoardDefault,
} from "../identity.js";
import type { BoardAdapter } from "../integration.js";
import { type BoardEnvelope } from "../protocol.js";
import { BoardSummarizer } from "../summarizer.js";
import { BoardCatchup } from "./catchup.js";
import { BoardOwner } from "./owner.js";
import { BoardRouting } from "./routing.js";
import { BoardTurns } from "./turns.js";

export class BoardRuntime {
	gptPromptMode = false;
	private preparePromptMode: ((ctx: ExtensionContext) => void) | undefined;
	private readonly pi: ExtensionAPI;
	private readonly routing: BoardRouting;
	private readonly turns: BoardTurns;
	private readonly owner: BoardOwner;
	private readonly awareness: BoardAwareness;
	private readonly catchup: BoardCatchup;
	private readonly summarizer = new BoardSummarizer();
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
			() => this.routing.adapter?.briefing,
			() => this.gptPromptMode,
		);
		this.catchup = new BoardCatchup(
			pi,
			this.awareness,
			(ctx, request) => this.toOwner(ctx, request),
			availability,
			() => this.gptPromptMode,
		);
		this.turns = new BoardTurns(
			pi,
			(ctx, request) => this.toOwner(ctx, request),
			availability,
			(ctx, ids) => this.awareness.markSeen(ctx, ids),
		);
		this.owner = new BoardOwner(
			this.turns,
			this.summarizer,
			() => this.routing.adapter,
			() => this.routing.requireAdapter(),
			(ctx, request, signal) => this.handle(ctx, request, signal),
		);
		this.routing = new BoardRouting(
			pi,
			this.turns,
			this.owner,
			(ctx) => this.refresh(ctx),
			availability,
		);
		pi.on("session_start", (_event, ctx) => {
			this.summarizer.cancelAll();
			this.availabilityWarning = undefined;
			setBoardDefault(ctx, true);
			return this.refresh(ctx);
		});
		pi.on("session_shutdown", () => this.summarizer.cancelAll());
		pi.on("before_agent_start", async (_event, ctx) => {
			this.preparePromptMode?.(ctx);
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
			const catchup = await this.promptCatchup(ctx);
			catchup.accepted();
			if (catchup.content)
				return {
					message: preparePolicyMessage({
						customType: "shepherdr-board-catchup",
						content: catchup.content.trim(),
						display: true,
					}),
				};
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
	setPromptModePreparation(prepare: (ctx: ExtensionContext) => void) {
		this.preparePromptMode = prepare;
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
	async promptCatchup(ctx: ExtensionContext) {
		return this.catchup.read(ctx);
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
		if (!own.enabled) {
			this.turns.active.clear();
			this.summarizer.cancelAll();
		}
		const changed =
			this.lastSetting?.sessionId !== own.sessionId ||
			this.lastSetting.enabled !== own.enabled;
		this.lastSetting = { sessionId: own.sessionId, enabled: own.enabled };
		if (changed && !own.upstream)
			await this.routing.propagateEnabled(ctx, own.enabled);
	}
	async setSetting(ctx: ExtensionContext, scope: BoardScope, enabled: boolean) {
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
	setAutomaticSummaries(ctx: ExtensionContext, automatic: boolean) {
		writeBoardSummaryAutomatic(ctx.cwd, automatic);
		if (!automatic) this.summarizer.cancelAll();
	}
	async execute(ctx: ExtensionContext, input: unknown, requestId: string) {
		const params = parseBoardRequest(input);
		const caller = binding(ctx);
		if (!caller.upstream) {
			const setting = rootBoardSetting(ctx);
			if (setting.error) throw new Error(setting.error);
		}
		if (!caller.enabled)
			throw new Error("Board is off; the user can enable it with /board on");
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
		return params.action === "help" && this.gptPromptMode
			? gptBoardHelp(value)
			: value;
	}
	async handle(ctx: ExtensionContext, value: unknown, signal?: AbortSignal) {
		return this.routing.handle(ctx, value, signal);
	}
	async toOwner(
		ctx: ExtensionContext,
		request: BoardEnvelope,
		signal?: AbortSignal,
	) {
		return this.routing.toOwner(ctx, request, signal);
	}
	attach(adapter: BoardAdapter) {
		this.routing.attach(adapter);
	}
	get active() {
		return this.turns.active;
	}
}
