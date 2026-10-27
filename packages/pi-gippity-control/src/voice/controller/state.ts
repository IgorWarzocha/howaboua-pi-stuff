import type { CodexVoiceMode } from "../ui.ts";
import type { ControllerHandoff } from "./handoff.ts";
import type { VoiceControllerRuntime } from "./start.ts";
import { renderVoiceStatus } from "./support.ts";

/** Owns observable controller presentation: mute subscriptions, level hint and active prompts. */
export class ControllerState {
	private readonly runtime: VoiceControllerRuntime;
	private readonly handoff: ControllerHandoff;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();
	private readonly activePrompts = new Map<string, string>();
	constructor(runtime: VoiceControllerRuntime, handoff: ControllerHandoff) {
		this.runtime = runtime;
		this.handoff = handoff;
	}
	notifyMute(muted: boolean): void {
		for (const listener of this.inputMuteListeners) listener(muted);
	}
	get activePrompt(): string | undefined {
		return Array.from(this.activePrompts.values()).at(-1);
	}
	resetPrompts(): void {
		this.activePrompts.clear();
	}
	setPrompt(report: { id: string; active: boolean; prompt: string }): void {
		if (!report.active) {
			this.activePrompts.delete(report.id);
			return;
		}
		if (this.activePrompts.get(report.id) === report.prompt) return;
		this.activePrompts.delete(report.id);
		this.activePrompts.set(report.id, report.prompt);
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.announcePrompt(report.prompt);
	}

	get status(): string {
		return this.handoff.forwarded &&
			(this.runtime.state.type === "idle" ||
				this.runtime.state.type === "failed")
			? "transferred"
			: this.runtime.state.type;
	}
	get active(): boolean {
		return (
			Boolean(this.handoff.forwarded) ||
			(this.runtime.state.type !== "idle" &&
				this.runtime.state.type !== "failed")
		);
	}
	get activeMode(): CodexVoiceMode | undefined {
		return (
			this.runtime.announcedMode ??
			(this.handoff.forwarded ? "realtime" : undefined)
		);
	}
	get inputMuted(): boolean {
		return this.runtime.state.type === "conversation" &&
			this.runtime.state.session !== this.handoff.departing
			? this.runtime.state.session.microphoneMuted
			: (this.handoff.forwarded?.inputMuted ?? false);
	}
	onInputMuteChange(listener: (muted: boolean) => void): () => void {
		this.inputMuteListeners.add(listener);
		return () => this.inputMuteListeners.delete(listener);
	}
	setInputMuted(muted: boolean): boolean {
		if (
			(this.runtime.state.type !== "conversation" ||
				this.runtime.state.session === this.handoff.departing) &&
			this.handoff.forwarded
		) {
			this.handoff.forwarded.setInputMuted(muted);
			return true;
		}
		if (
			this.runtime.state.type !== "conversation" ||
			this.runtime.announcedMode !== "realtime"
		)
			return false;
		const previous = this.runtime.state.session.microphoneMuted;
		this.runtime.state.session.setInputMuted(muted);
		const current = this.runtime.state.session.microphoneMuted;
		if (previous !== current) {
			this.renderCurrentStatus();
			for (const listener of this.inputMuteListeners) listener(current);
		}
		return true;
	}
	setInputTooQuiet(inputTooQuiet: boolean): void {
		const receivesInput =
			this.runtime.state.type === "conversation" ||
			this.runtime.state.type === "reconnecting" ||
			this.runtime.state.type === "connecting";
		const next = receivesInput && inputTooQuiet;
		if (this.runtime.inputTooQuiet === next) return;
		this.runtime.inputTooQuiet = next;
		this.renderCurrentStatus();
	}
	renderStatus(status: string): void {
		this.runtime.voiceStatus = status;
		this.renderCurrentStatus();
	}

	renderCurrentStatus(): void {
		renderVoiceStatus(
			this.runtime.context,
			this.runtime.voiceStatus,
			this.inputMuted,
			this.runtime.inputTooQuiet,
		);
	}
}
