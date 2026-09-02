import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../../config.ts";
import { resolveCodexVoiceAuth } from "../auth.ts";
import type { CodexVoiceController } from "../controller.ts";
import { boundedAssistantText } from "./activity.ts";
import { appendLanRemoteCreateNotice } from "./create.ts";
import type { GippityRemoteApps } from "./remote-app.ts";
import type { CodexLanVoiceServer } from "./server.ts";

export interface CodexLanVoiceServerStatus {
	running: boolean;
	urls: string[];
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
