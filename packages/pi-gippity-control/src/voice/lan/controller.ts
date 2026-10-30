import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../../config.ts";
import { resolveCodexVoiceAuth } from "../auth.ts";
import type { PreparedRealtimeContext } from "../controller/start.ts";
import type { CodexVoiceController } from "../controller.ts";
import { boundedAssistantText } from "./activity.ts";
import { appendLanRemoteCreateNotice } from "./create.ts";
import type { GippityRemoteApps } from "./remote-app.ts";
import type { CodexLanVoiceServer } from "./server.ts";
import {
	assertLanTakeoverIdentity,
	type LanTakeoverOffer,
	prepareLanTakeover,
} from "./takeover.ts";

export interface CodexLanVoiceServerStatus {
	running: boolean;
	urls: string[];
	browserAttached: boolean;
}

export class CodexLanVoiceServerController {
	private readonly voice: CodexVoiceController;
	private readonly pi: ExtensionAPI;
	private readonly getConfig: () => GippityControlConfig;
	private readonly sendUserMessage: (
		text: string,
		ctx: ExtensionContext,
	) => void;
	private readonly agentDir: string;
	private readonly remoteApps: GippityRemoteApps;
	private server: CodexLanVoiceServer | undefined;
	private pendingAssistantText: string | undefined;
	private operation = Promise.resolve();
	private readonly browserStarts = new Set<AbortController>();
	private takeoverReservation: object | undefined;

	constructor(
		pi: ExtensionAPI,
		voice: CodexVoiceController,
		getConfig: () => GippityControlConfig,
		sendUserMessage: (text: string, ctx: ExtensionContext) => void,
		agentDir: string,
		remoteApps: GippityRemoteApps,
	) {
		this.pi = pi;
		this.voice = voice;
		this.getConfig = getConfig;
		this.sendUserMessage = sendUserMessage;
		this.agentDir = agentDir;
		this.remoteApps = remoteApps;
	}

	status(): CodexLanVoiceServerStatus {
		return {
			running: Boolean(this.server),
			urls: this.server?.urls ?? [],
			browserAttached: this.server?.browserAttached ?? false,
		};
	}

	getStatus(): Promise<CodexLanVoiceServerStatus> {
		return this.enqueue(async () => this.status());
	}

	get hostsConversation(): boolean {
		return this.server?.hasConversation ?? false;
	}

	async prepareTakeover(ctx: ExtensionContext) {
		const reservation = {};
		await this.enqueue(async () => {
			if (this.server || this.takeoverReservation)
				throw new Error(
					"The target already has a running or preparing LAN server",
				);
			this.takeoverReservation = reservation;
		});
		try {
			const prepared = await prepareLanTakeover(this.agentDir);
			const ownerSessionId = ctx.sessionManager.getSessionId();
			return {
				offer: prepared.offer,
				certificate: prepared.certificate,
				release: () => {
					if (this.takeoverReservation === reservation)
						this.takeoverReservation = undefined;
				},
				start: (
					port: number,
					context: PreparedRealtimeContext,
					inputMuted: boolean,
					alternateVoice: boolean,
					signal: AbortSignal,
				) =>
					this.enqueue(async () => {
						signal.throwIfAborted();
						if (
							this.takeoverReservation !== reservation ||
							ctx.sessionManager.getSessionId() !== ownerSessionId
						)
							throw new Error("LAN takeover was cancelled before binding");
						const { startCodexLanVoiceServer } = await import("./server.ts");
						const server = await startCodexLanVoiceServer({
							ctx,
							pi: this.pi,
							getConfig: this.getConfig,
							voice: this.voice,
							resolveAuth: () => resolveCodexVoiceAuth(ctx),
							sendUserMessage: (text) => this.sendUserMessage(text, ctx),
							ownerSessionId,
							certificateAgentDir: this.agentDir,
							remoteApps: this.remoteApps,
							port,
							certificate: prepared.certificate,
							takeoverToken: prepared.offer.token,
							arrival: { prepared: context, inputMuted, alternateVoice },
						});
						if (signal.aborted || this.takeoverReservation !== reservation) {
							await server.close();
							throw new Error("LAN takeover cancelled while binding");
						}
						this.server = server;
						ctx.ui.setStatus(
							"gippity-lan",
							ctx.ui.theme.fg("accent", "GipPity LAN: on"),
						);
					}),
			};
		} catch (error) {
			if (this.takeoverReservation === reservation)
				this.takeoverReservation = undefined;
			throw error;
		}
	}

	async releaseForTakeover(
		ctx: ExtensionContext,
		offer: LanTakeoverOffer | undefined,
		releaseAudio: (beforeStop?: () => Promise<void>) => Promise<void>,
		verify: (value: unknown) => Promise<unknown>,
	): Promise<number | undefined> {
		return this.enqueue(async () => {
			const server = this.server;
			if (
				!server?.hasConversation ||
				server.ownerSessionId !== ctx.sessionManager.getSessionId()
			)
				throw new Error("The source LAN conversation changed before takeover");
			try {
				if (!offer)
					throw new Error("The target cannot take over this LAN address");
				assertLanTakeoverIdentity(
					{ certificate: server.certificateFingerprint },
					offer,
				);
				await server.proveTakeover(verify);
			} catch (error) {
				ctx.ui.notify(
					`LAN remains at the source; closing it ends the voice call. ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
				return undefined;
			}
			await releaseAudio(() => server.acknowledgeTakeover(offer.token));
			await server.releaseForTakeover();
			if (this.server === server) this.server = undefined;
			ctx.ui.setStatus("gippity-lan", undefined);
			return server.port;
		});
	}

	setEnabled(
		enabled: boolean,
		ctx: ExtensionContext,
	): Promise<CodexLanVoiceServerStatus> {
		if (!enabled) this.cancelBrowserStarts();
		return this.enqueue(() => this.setEnabledCurrent(enabled, ctx));
	}

	connectBrowser<T>(
		ctx: ExtensionContext,
		start: (
			status: CodexLanVoiceServerStatus,
			signal: AbortSignal,
		) => Promise<T>,
	): Promise<T> {
		// Reserve before enqueueing so Stop also cancels starts still in the queue.
		const abort = new AbortController();
		this.browserStarts.add(abort);
		return this.enqueue(async () => {
			abort.signal.throwIfAborted();
			if (
				this.voice.active ||
				this.hostsConversation ||
				this.status().browserAttached
			)
				throw new Error(
					"Voice or browser audio is already active. Stop it before connecting another browser.",
				);
			const status = await this.setEnabledCurrent(true, ctx);
			abort.signal.throwIfAborted();
			const result = await start(status, abort.signal);
			abort.signal.throwIfAborted();
			return result;
		}).finally(() => this.browserStarts.delete(abort));
	}

	private async setEnabledCurrent(
		enabled: boolean,
		ctx: ExtensionContext,
	): Promise<CodexLanVoiceServerStatus> {
		if (this.takeoverReservation)
			throw new Error("LAN takeover is preparing; wait for it to finish");
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
			pi: this.pi,
			getConfig: this.getConfig,
			voice: this.voice,
			resolveAuth: () => resolveCodexVoiceAuth(ctx),
			sendUserMessage: (text) => this.sendUserMessage(text, ctx),
			ownerSessionId: sessionId,
			certificateAgentDir: this.agentDir,
			remoteApps: this.remoteApps,
		});
		ctx.ui.setStatus(
			"gippity-lan",
			ctx.ui.theme.fg("accent", "GipPity LAN: on"),
		);
		const config = this.getConfig();
		const needsCustomApp =
			config.lan.customWebApp && !this.server.customWebAppReady;
		ctx.ui.notify(
			`GipPity control server is running:\n${this.server.urls.join("\n")}\nAccept the local certificate on first visit.${needsCustomApp ? "\nNo custom web app is connected. Run /gippity create." : ""}`,
			"info",
		);
		if (needsCustomApp) {
			appendLanRemoteCreateNotice(
				this.pi,
				`${this.server.urls[0]}/api/discovery`,
			);
		}
		return this.status();
	}

	stop(ctx?: ExtensionContext): Promise<void> {
		this.cancelBrowserStarts();
		this.takeoverReservation = undefined;
		return this.enqueue(() => this.stopCurrent(ctx));
	}

	private cancelBrowserStarts(): void {
		for (const abort of this.browserStarts) abort.abort();
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
		else if (message.stopReason !== "toolUse")
			this.pendingAssistantText = undefined;
	}

	agentSettled(): void {
		if (!this.server) return;
		this.server.agentSettled(this.pendingAssistantText);
		this.pendingAssistantText = undefined;
	}

	piEvent(event: string, data: unknown): void {
		this.server?.piEvent(event, data);
	}

	private async stopCurrent(ctx?: ExtensionContext): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.pendingAssistantText = undefined;
		ctx?.ui.setStatus("gippity-lan", undefined);
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
