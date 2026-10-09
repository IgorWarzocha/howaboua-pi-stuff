import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { NativeAudio } from "./audio/native.ts";
import type { RealtimeAudio } from "./audio.ts";
import { readConfig } from "./config.ts";
import { GrokRealtimeController } from "./controller.ts";
import { GrokDictationController } from "./dictation.ts";

/** Serializes microphone ownership across voice, dictation, local and LAN controls. */
export class GrokControls {
	readonly voice: GrokRealtimeController;
	readonly dictation: GrokDictationController;
	onChange: (() => void) | undefined;
	private operation = Promise.resolve();
	private generation = 0;
	private pendingStarts = 0;
	get preparing(): boolean {
		return this.pendingStarts > 0;
	}
	private localDraft: ExtensionContext | undefined;
	constructor(pi: ExtensionAPI) {
		this.voice = new GrokRealtimeController(pi);
		this.dictation = new GrokDictationController(pi);
		this.voice.onChange = () => this.onChange?.();
		this.dictation.onChange = () => {
			const state = this.dictation.state();
			const ctx = this.localDraft;
			if (ctx) {
				ctx.ui.setWidget(
					"grok-dictation",
					state.text ? [`Dictation: ${state.text}`] : undefined,
				);
				ctx.ui.setStatus("grok-dictation", `Dictation: ${state.status}`);
				if (state.error) {
					ctx.ui.notify(
						`${state.error}${state.text ? ". Partial transcript left in the editor" : ""}`,
						"error",
					);
					this.deliverDraft(state.text);
				} else if (state.status === "done") this.deliverDraft(state.text);
			}
			this.onChange?.();
		};
	}
	cancelStartup(): void {
		this.voice.cancelStartup();
		this.dictation.cancelStartup();
	}
	startVoice(ctx: ExtensionContext, audio?: RealtimeAudio): Promise<void> {
		this.pendingStarts++;
		const generation = ++this.generation;
		this.cancelStartup();
		return this.enqueue(async () => {
			await this.stopCurrent();
			if (generation !== this.generation)
				throw new Error("Voice startup cancelled");
			const config = readConfig();
			await this.voice.start(ctx, config, audio ?? new NativeAudio(config));
		}).finally(() => {
			this.pendingStarts--;
		});
	}
	startDictation(ctx: ExtensionContext, audio?: RealtimeAudio): Promise<void> {
		this.pendingStarts++;
		const generation = ++this.generation;
		this.cancelStartup();
		return this.enqueue(async () => {
			await this.stopCurrent();
			if (generation !== this.generation)
				throw new Error("Dictation startup cancelled");
			const config = readConfig();
			if (!audio) this.localDraft = ctx;
			try {
				await this.dictation.start(
					ctx,
					config,
					audio ?? new NativeAudio(config),
				);
			} catch (error) {
				this.clearDraft();
				throw error;
			}
		}).finally(() => {
			this.pendingStarts--;
		});
	}
	async toggleVoice(ctx: ExtensionContext): Promise<void> {
		if (this.voice.state().status !== "idle") await this.stop();
		else await this.startVoice(ctx);
	}
	async toggleDictation(ctx: ExtensionContext): Promise<void> {
		if (
			["connecting", "recording", "finishing"].includes(
				this.dictation.state().status,
			)
		)
			await this.finishDictation();
		else await this.startDictation(ctx);
	}
	async finishDictation(): Promise<string> {
		try {
			const text = await this.dictation.finish();
			this.deliverDraft(text);
			return text;
		} finally {
			this.clearDraft();
		}
	}
	async cancelDictation(): Promise<void> {
		this.generation++;
		this.clearDraft();
		await this.dictation.cancel();
	}
	stop(): Promise<void> {
		this.generation++;
		this.cancelStartup();
		return this.enqueue(() => this.stopCurrent());
	}
	private async stopCurrent(): Promise<void> {
		this.clearDraft();
		await Promise.all([this.voice.stop(), this.dictation.cancel()]);
	}
	private deliverDraft(text: string): void {
		const ctx = this.localDraft;
		if (!ctx) return;
		if (text.trim()) {
			const existing = ctx.ui.getEditorText();
			ctx.ui.setEditorText(
				`${existing}${existing && !/\s$/.test(existing) ? " " : ""}${text}`,
			);
		}
		this.clearDraft();
	}
	private clearDraft(): void {
		this.localDraft?.ui.setWidget("grok-dictation", undefined);
		this.localDraft?.ui.setStatus("grok-dictation", undefined);
		this.localDraft = undefined;
	}
	private enqueue(action: () => Promise<void>): Promise<void> {
		const result = this.operation.then(action, action);
		this.operation = result.catch(() => {});
		return result;
	}
}
