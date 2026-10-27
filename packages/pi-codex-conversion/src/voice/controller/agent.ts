import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ContextEvent,
} from "@earendil-works/pi-coding-agent";
import type { VoiceControllerRuntime } from "./start.ts";
import { completedVoiceReasoningSummary } from "../reasoning-summary.ts";
import { CodexVoiceSessionMessages } from "../session-messages.ts";

/** Owns Pi-turn delivery and the translation of assistant output into live voice progress. */
export class ControllerAgent {
	readonly messages: CodexVoiceSessionMessages;
	private readonly runtime: VoiceControllerRuntime;
	constructor(
		pi: ExtensionAPI,
		runtime: VoiceControllerRuntime,
		onWorking: () => void,
	) {
		this.runtime = runtime;
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.runtime.state.type === "conversation",
			onDelegation: (id, input, source) => {
				if (this.runtime.state.type !== "conversation") return;
				const current = this.runtime.state.session;
				// Delegation IDs belong to their call. Carried work uses session output.
				if (current === source) current.activateDelegation(id);
				else current.piInput(input);
			},
			onDelegationFailed: () => {
				if (this.runtime.state.type === "conversation")
					this.runtime.state.session.settleAgentTurn();
			},
			onWorking: () => onWorking(),
		});
	}
	agentStarted(): void {
		this.messages.agentStarted();
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.agentStarted();
	}

	filterContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
		return this.messages.filterContext(messages);
	}

	piInput(input: unknown, streamingBehavior?: "steer" | "followUp"): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.piInput(input, streamingBehavior)
		);
	}

	piUserMessage(message: unknown): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.piUserMessage(message)
		);
	}

	streamUpdate(update: AssistantMessageEvent): void {
		if (this.runtime.state.type !== "conversation") return;
		if (update.type === "text_delta")
			this.runtime.state.session.streamAgentDelta(update.delta);
		else if (
			update.type === "thinking_start" ||
			update.type === "toolcall_start"
		)
			this.runtime.state.session.resumeAgentWork();
	}

	finishAgentMessage(
		message: AssistantMessage,
		forwardReasoningSummaries: boolean,
	): void {
		if (this.runtime.state.type !== "conversation") return;
		const completedText = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		if (message.stopReason === "toolUse") {
			const progress = completedText.trim()
				? completedText
				: forwardReasoningSummaries
					? completedVoiceReasoningSummary(message)
					: undefined;
			if (progress) this.runtime.state.session.agentProgress(progress);
			return;
		}
		this.runtime.state.session.agentResult(completedText);
	}

	settleTurn(): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}
}
