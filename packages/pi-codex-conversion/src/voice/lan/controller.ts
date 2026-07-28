import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import type { CodexLanVoiceServer } from "./server.ts";
import { boundedAssistantText } from "./activity.ts";

export interface CodexLanVoiceServerStatus {
	running: boolean;
	urls: string[];
}

export class CodexLanVoiceServerController {
	private readonly voice: CodexVoiceController;
	private readonly getConfig: () => CodexConversionConfig;
	private readonly sendUserMessage: (text: string, ctx: ExtensionContext) => void;
	private readonly agentDir: string;
	private server: CodexLanVoiceServer | undefined;
	private pendingAssistantText: string | undefined;
	private operation = Promise.resolve();

	constructor(
		voice: CodexVoiceController,
		getConfig: () => CodexConversionConfig,
		sendUserMessage: (text: string, ctx: ExtensionContext) => void,
		agentDir: string,
	) {
		this.voice = voice;
		this.getConfig = getConfig;
		this.sendUserMessage = sendUserMessage;
		this.agentDir = agentDir;
	}

	status(): CodexLanVoiceServerStatus {
		return { running: Boolean(this.server), urls: this.server?.urls ?? [] };
	}

	setEnabled(
		enabled: boolean,
		ctx: ExtensionContext,
	): Promise<CodexLanVoiceServerStatus> {
		return this.enqueue(async () => {
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
				getConfig: this.getConfig,
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
		return this.enqueue(() => this.stopCurrent(ctx));
	}

	agentStarted(): void {
		if (!this.server) return;
		this.pendingAssistantText = undefined;
		this.server.agentStarted();
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
