import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexLanVoiceServer } from "./server.ts";
import { boundedAssistantText } from "./activity.ts";
import { createLanVoiceSettings } from "./settings.ts";
import { assertLanTakeoverIdentity, prepareLanTakeover, type LanTakeoverOffer } from "./takeover.ts";
import type { PreparedRealtimeContext } from "../controller/start.ts";

export interface CodexLanVoiceServerStatus {
	running: boolean;
	urls: string[];
	browserAttached: boolean;
}

export class CodexLanVoiceServerController {
	private readonly voice: CodexVoiceController;
	private readonly getConfig: () => CodexConversionConfig;
	private readonly sendUserMessage: (text: string, ctx: ExtensionContext) => void;
	private readonly agentDir: string;
	private readonly hasWebSearch: (() => boolean) | undefined;
	private server: CodexLanVoiceServer | undefined;
	private pendingAssistantText: string | undefined;
	private operation = Promise.resolve();
	private takeoverReservation: object | undefined;

	constructor(
		voice: CodexVoiceController,
		getConfig: () => CodexConversionConfig,
		sendUserMessage: (text: string, ctx: ExtensionContext) => void,
		agentDir: string,
		hasWebSearch?: () => boolean,
	) {
		this.voice = voice;
		this.getConfig = getConfig;
		this.sendUserMessage = sendUserMessage;
		this.agentDir = agentDir;
		this.hasWebSearch = hasWebSearch;
	}

	status(): CodexLanVoiceServerStatus {
		return { running: Boolean(this.server), urls: this.server?.urls ?? [], browserAttached: this.server?.browserAttached() ?? false };
	}

	hasActiveConversation(): boolean { return this.server?.hasActiveConversation() ?? false; }
	hasActiveVoice(): boolean { return this.voice.active; }

	async prepareTakeover(ctx: ExtensionContext) {
		const reservation = {};
		await this.enqueue(async () => {
			if (this.server || this.takeoverReservation) throw new Error("The target already has a running or preparing LAN server");
			this.takeoverReservation = reservation;
		});
		try {
			const prepared = await prepareLanTakeover(this.agentDir);
			const ownerSessionId = ctx.sessionManager.getSessionId();
			let startedServer: CodexLanVoiceServer | undefined;
			return {
				offer: prepared.offer,
				verify: (value: unknown) => import("./takeover.ts").then(({ verifyLanTakeoverListener }) => verifyLanTakeoverListener(prepared.certificate.cert, value)),
				release: () => { if (this.takeoverReservation === reservation) this.takeoverReservation = undefined; },
				cancel: () => {
					if (this.takeoverReservation === reservation) this.takeoverReservation = undefined;
					return this.enqueue(async () => { if (startedServer && this.server === startedServer) await this.stopCurrent(ctx); });
				},
				start: (port: number, context: PreparedRealtimeContext, inputMuted: boolean, alternateVoice: boolean) => this.enqueue(async () => {
					if (this.takeoverReservation !== reservation || ctx.sessionManager.getSessionId() !== ownerSessionId)
						throw new Error("LAN takeover was cancelled before binding");
					const { startCodexLanVoiceServer } = await import("./server.ts");
					const server = await startCodexLanVoiceServer({
						ctx, settings: createLanVoiceSettings(ctx, this.getConfig, this.hasWebSearch), voice: this.voice,
						resolveAuth: () => resolveCodexVoiceAuth(ctx), sendUserMessage: (text) => this.sendUserMessage(text, ctx),
						ownerSessionId, certificateAgentDir: this.agentDir, port, certificate: prepared.certificate,
						takeover: { token: prepared.offer.token, prepared: context, inputMuted, alternateVoice },
					});
					if (this.takeoverReservation !== reservation || ctx.sessionManager.getSessionId() !== ownerSessionId) {
						await server.close();
						throw new Error("LAN takeover cancelled while binding");
					}
					startedServer = server;
					this.server = server;
					ctx.ui.setStatus("codex-lan-voice", ctx.ui.theme.fg("accent", "voice LAN: on"));
				}),
			};
		} catch (error) {
			if (this.takeoverReservation === reservation) this.takeoverReservation = undefined;
			throw error;
		}
	}

	async releaseForTakeover(ctx: ExtensionContext, offer: LanTakeoverOffer, releaseAudio: (beforeStop?: () => Promise<void>) => Promise<void>, verify: (proof: { port: number; token: string }) => Promise<void>): Promise<number | undefined> {
		return this.enqueue(async () => {
			const server = this.server;
			if (!server || server.ownerSessionId !== ctx.sessionManager.getSessionId()) throw new Error("The source LAN server changed before takeover");
			try {
				assertLanTakeoverIdentity({ certificate: server.certificateFingerprint }, offer);
				await server.verifyTakeoverHost(verify);
			} catch (error) {
				ctx.ui.notify(`Same-address takeover unavailable: ${error instanceof Error ? error.message : String(error)}. LAN remains on the origin; closing it ends the transferred call.`, "warning");
				return undefined;
			}
			await releaseAudio(() => server.notifyTakeover(offer.token));
			await server.takeover();
			if (this.server === server) this.server = undefined;
			ctx.ui.setStatus("codex-lan-voice", undefined);
			return server.port;
		});
	}

	setEnabled(
		enabled: boolean,
		ctx: ExtensionContext,
	): Promise<CodexLanVoiceServerStatus> {
		return this.enqueue(async () => {
			if (this.takeoverReservation) throw new Error("LAN takeover is preparing; wait for it to finish");
			if (!enabled) {
				await this.stopCurrent(ctx);
				return this.status();
			}
			const sessionId = ctx.sessionManager.getSessionId();
			if (this.server?.ownerSessionId === sessionId) return this.status();
			await this.stopCurrent(ctx);
			const { startCodexLanVoiceServer } = await import("./server.ts");
			this.server = await startCodexLanVoiceServer({
				ctx,
				settings: createLanVoiceSettings(ctx, this.getConfig, this.hasWebSearch),
				voice: this.voice,
				resolveAuth: () => resolveCodexVoiceAuth(ctx),
				sendUserMessage: (text) => this.sendUserMessage(text, ctx),
				ownerSessionId: sessionId,
				certificateAgentDir: this.agentDir,
			});
			ctx.ui.setStatus(
				"codex-lan-voice",
				ctx.ui.theme.fg("accent", "voice LAN: on"),
			);
			ctx.ui.notify(
				`LAN voice is running:\n${this.server.urls.join("\n")}\nAccept the local certificate on first visit.`,
				"info",
			);
			return this.status();
		});
	}

	stop(ctx?: ExtensionContext): Promise<void> {
		this.takeoverReservation = undefined;
		return this.enqueue(() => this.stopCurrent(ctx));
	}

	agentStarted(): void {
		if (!this.server) return;
		this.pendingAssistantText = undefined;
		this.server.agentStarted();
	}

	uiPromptStarted(title?: string): void {
		this.server?.uiPromptStarted(title);
	}

	uiPromptEnded(agentRunning: boolean): void {
		this.server?.uiPromptEnded(agentRunning);
	}

	assistantMessage(message: AssistantMessage): void {
		if (!this.server) return;
		const text = boundedAssistantText(message.content);
		if (text) this.pendingAssistantText = text;
		else if (message.stopReason !== "toolUse") this.pendingAssistantText = undefined;
	}

	agentSettled(): void {
		if (!this.server) return;
		this.server.agentSettled(this.pendingAssistantText);
		this.pendingAssistantText = undefined;
	}

	private async stopCurrent(ctx?: ExtensionContext): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.pendingAssistantText = undefined;
		ctx?.ui.setStatus("codex-lan-voice", undefined);
		await server?.close();
	}

	private enqueue<T>(action: () => Promise<T>): Promise<T> {
		const result = this.operation.then(action, action);
		this.operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
