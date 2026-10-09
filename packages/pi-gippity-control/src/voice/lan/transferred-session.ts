import type { TransferredVoiceControls } from "../handoff-contract.ts";
import { boundedAssistantText, type LanVoiceActivity } from "./activity.ts";
import type { LanVoiceBrowserClients } from "./browser-clients.ts";

/** Session events use the same names as Pi's local event bridge. */
export class LanTransferredSession {
	private removeListener: (() => void) | undefined;
	private assistantText: string | undefined;
	private readonly activity: LanVoiceActivity;
	readonly controls: TransferredVoiceControls;
	ended = false;
	private sessionInfo: unknown;
	private agentRunning = false;

	constructor(
		controls: TransferredVoiceControls,
		clients: LanVoiceBrowserClients,
		activity: LanVoiceActivity,
	) {
		this.controls = controls;
		this.activity = activity;
		activity.settled();
		this.removeListener = controls.onSessionEvent((event, data) => {
			if (event === "voice_mute" && typeof data === "boolean") {
				if (data) clients.resetConversationInputLevel();
				clients.broadcastControl({ type: "mute", muted: data });
			} else if (event === "voice_status" && typeof data === "string") {
				clients.broadcastControl({ type: "status", status: data });
			} else {
				if (event === "session_info_changed") this.sessionInfo = data;
				this.updateActivity(event, data);
				clients.broadcastControl({ type: "pi.event", event, data });
			}
		});
		clients.broadcastControl({ type: "mute", muted: controls.inputMuted });
	}

	detach(): void {
		this.removeListener?.();
		this.removeListener = undefined;
	}

	end(): void {
		if (this.ended) return;
		this.ended = true;
		this.detach();
		this.activity.settled(
			"Transferred session ended. Start voice to return to this session",
		);
	}

	snapshot(): unknown {
		return this.sessionInfo === undefined
			? undefined
			: {
					type: "pi.event",
					event: "session_info_changed",
					data: this.sessionInfo,
				};
	}

	sendText(text: string): Promise<void> {
		this.assertActive();
		return this.controls.sendText(text);
	}

	rpc(body: Record<string, unknown>): Promise<unknown> {
		this.assertActive();
		return this.controls.rpc(body);
	}

	async stop(): Promise<void> {
		if (this.ended) return;
		try {
			await this.controls.stop();
		} finally {
			this.end();
		}
	}

	private assertActive(): void {
		if (this.ended)
			throw new Error(
				"Transferred session ended; start voice to return to this session",
			);
	}

	private updateActivity(event: string, data: unknown): void {
		if (event === "agent_start") {
			this.agentRunning = true;
			this.assistantText = undefined;
			this.activity.working();
		} else if (event === "message_end" && data && typeof data === "object") {
			const message = (
				data as {
					message?: { role?: string; content?: unknown; stopReason?: string };
				}
			).message;
			if (message?.role === "assistant" && Array.isArray(message.content)) {
				const text = boundedAssistantText(message.content);
				if (text) this.assistantText = text;
				else if (message.stopReason !== "toolUse")
					this.assistantText = undefined;
			}
		} else if (event === "agent_settled") {
			this.agentRunning = false;
			this.activity.settled(this.assistantText);
			this.assistantText = undefined;
		} else if (event === "ui_prompt_start") {
			const title =
				data &&
				typeof data === "object" &&
				"title" in data &&
				typeof data.title === "string"
					? data.title
					: undefined;
			this.activity.waiting(title);
		} else if (event === "ui_prompt_end") {
			if (this.agentRunning) this.activity.working();
			else this.activity.settled();
		}
	}
}
