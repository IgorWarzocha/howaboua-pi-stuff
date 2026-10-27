import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import type { NotesLifecycle } from "./lifecycle.js";
import { SETTLEMENT_ENTRY } from "./windows.js";

interface HeldInput {
	sessionId: string;
	phase: "failed" | "rolling" | "releasing" | "draining";
	releasePrompt: string;
	admissions: ((result: InputEventResult) => void)[];
}

// Owns suspended input calls and custom-kickoff admission; reset settles held callers.
export class IdleAdmission {
	private held: HeldInput | undefined;
	private customAdmission: Promise<void> | undefined;
	private readonly host: Pick<
		NotesLifecycle,
		"active" | "fresh" | "windows" | "idleMinutes"
	>;
	private readonly pi: ExtensionAPI;
	private readonly roll: (
		ctx: ExtensionContext,
		triggerTurn: boolean,
	) => Promise<void>;
	private readonly rolloverPending: () => boolean;
	private readonly checkpointPending: () => boolean;
	constructor(
		host: IdleAdmission["host"],
		pi: ExtensionAPI,
		roll: IdleAdmission["roll"],
		rolloverPending: () => boolean,
		checkpointPending: () => boolean,
	) {
		this.host = host;
		this.pi = pi;
		this.roll = roll;
		this.rolloverPending = rolloverPending;
		this.checkpointPending = checkpointPending;
	}
	get pending(): boolean {
		return Boolean(this.held);
	}
	reset(): void {
		this.customAdmission = undefined;
		for (const admit of this.held?.admissions ?? [])
			admit({ action: "handled" });
		this.held = undefined;
	}
	fail(ctx: ExtensionContext, error: unknown): void {
		if (this.held) this.failHeld(ctx, this.held, error);
	}
	drain(): boolean {
		if (this.held?.phase !== "draining") return false;
		// Retry admissions are original SDK calls too. Releasing all at once races Agent.prompt.
		this.held.phase = "releasing";
		this.pi.sendUserMessage(this.held.releasePrompt);
		return true;
	}

	prepareCustomTurn(ctx: ExtensionContext): Promise<void> | undefined {
		if (this.customAdmission) return this.customAdmission;
		if (!this.host.active || !this.idleDue(ctx) || !this.host.fresh(ctx))
			return;
		const sessionId = ctx.sessionManager.getSessionId();
		const preparation = this.roll(ctx, false)
			.then(() => {
				if (
					!this.host.active ||
					sessionId !== ctx.sessionManager.getSessionId()
				)
					throw new Error("Session changed during custom kickoff admission");
			})
			.finally(() => {
				if (this.customAdmission === preparation)
					this.customAdmission = undefined;
			});
		this.customAdmission = preparation;
		return preparation;
	}
	private idleDue(ctx: ExtensionContext): boolean {
		if (
			this.host.idleMinutes === 0 ||
			!ctx.isIdle() ||
			!this.host.windows.current ||
			this.rolloverPending() ||
			this.checkpointPending()
		)
			return false;
		const branch = ctx.sessionManager.getBranch();
		const terminal = branch.findLast(
			(entry) => entry.type === "message" && entry.message.role !== "system",
		);
		if (!terminal) return false;
		const settlement = ctx.sessionManager
			.getEntries()
			.findLast(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === SETTLEMENT_ENTRY &&
					entry.data &&
					typeof entry.data === "object" &&
					"completedEntryId" in entry.data &&
					entry.data.completedEntryId === terminal.id,
			);
		if (
			settlement?.type !== "custom" ||
			!settlement.data ||
			typeof settlement.data !== "object"
		)
			return false;
		const data = settlement.data;
		return (
			!("aborted" in data && data.aborted === true) &&
			"windowId" in data &&
			data.windowId === this.host.windows.current.currentWindowId &&
			"settledAt" in data &&
			typeof data.settledAt === "number" &&
			Number.isFinite(data.settledAt) &&
			Date.now() - data.settledAt >= this.host.idleMinutes * 60_000
		);
	}
	async input(
		event: InputEvent,
		ctx: ExtensionContext,
	): Promise<InputEventResult | undefined> {
		const releasing = this.held;
		if (
			releasing?.phase === "releasing" &&
			event.source === "extension" &&
			event.text === releasing.releasePrompt
		) {
			const admit = releasing.admissions.shift();
			if (releasing.admissions.length) releasing.phase = "draining";
			else this.held = undefined;
			admit?.({ action: "continue" });
			return { action: "handled" };
		}
		if (!this.held && (!this.idleDue(ctx) || !this.host.fresh(ctx))) return;
		const held =
			this.held ??
			({
				sessionId: ctx.sessionManager.getSessionId(),
				phase: "failed",
				releasePrompt: `Admit saved input: ${randomUUID()}`,
				admissions: [],
			} satisfies HeldInput);
		this.held = held;
		const admission = new Promise<InputEventResult>((resolve) =>
			held.admissions.push(resolve),
		);
		if (held.phase !== "failed") return admission;
		held.phase = "rolling";
		void Promise.resolve().then(async () => {
			try {
				if (
					this.held !== held ||
					held.sessionId !== ctx.sessionManager.getSessionId()
				)
					return;
				await this.finishHeld(ctx, held);
			} catch (error) {
				this.failHeld(ctx, held, error);
			}
		});
		return admission;
	}
	private failHeld(
		ctx: ExtensionContext,
		held: HeldInput,
		error: unknown,
	): void {
		if (this.held !== held) return;
		held.phase = "failed";
		ctx.ui.notify(
			`Idle rollover failed: ${error instanceof Error ? error.message : String(error)}. Input and attachments remain pending. Submit another prompt to retry, or reload to cancel.`,
			"error",
		);
	}
	private async finishHeld(
		ctx: ExtensionContext,
		held: HeldInput,
	): Promise<void> {
		held.phase = "rolling";
		await this.roll(ctx, false);
		if (
			this.held !== held ||
			held.sessionId !== ctx.sessionManager.getSessionId()
		)
			return;
		held.phase = "releasing";
		// Pi defers this user kickoff until EVERY agent_settled handler returns.
		// Its input-only admission releases the original SDK calls, preserving images/options.
		this.pi.sendUserMessage(held.releasePrompt);
	}
}
