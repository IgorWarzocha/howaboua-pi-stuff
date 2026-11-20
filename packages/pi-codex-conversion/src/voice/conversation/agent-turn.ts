import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	RealtimeDelegationHandoff,
	RealtimeHandoffChannel,
	RealtimePiInputBehavior,
} from "./handoff.ts";

interface AgentTurnCallbacks {
	sendContext(channel: RealtimeHandoffChannel, text: string): void;
	completedOutputs(): number;
	hasPendingOutput(): boolean;
	onListening(): void;
	onEndCall(): void;
}

/** Routes Pi output and owns end intent tied to a delegated result. */
export class ConversationAgentTurn {
	private readonly handoff: RealtimeDelegationHandoff;
	private readonly callbacks: AgentTurnCallbacks;
	private ending = false;
	private endAfterResult: { id: string; active: boolean } | undefined;
	private endingOutput = 0;

	constructor(
		handoff: RealtimeDelegationHandoff,
		callbacks: AgentTurnCallbacks,
	) {
		this.handoff = handoff;
		this.callbacks = callbacks;
	}

	get isEnding(): boolean {
		return this.ending;
	}

	get finalOutputTarget(): number {
		return this.endingOutput;
	}

	requestEnd(finalOutputObserved = false, resultDelegationId?: string): void {
		if (resultDelegationId) {
			this.endAfterResult = { id: resultDelegationId, active: false };
			this.callbacks.sendContext(
				"commentary",
				"The user wants the requested answer before ending the call. When its result arrives, speak the answer and a brief farewell.",
			);
		} else this.beginEnding(finalOutputObserved);
	}

	interruptEnding(): void {
		this.ending = false;
		this.endAfterResult = undefined;
	}

	activateDelegation(id: string): void {
		if (this.endAfterResult?.active && this.endAfterResult.id !== id)
			this.endAfterResult = undefined;
		this.handoff.activate(id);
		if (this.endAfterResult?.id === id) this.endAfterResult.active = true;
	}

	agentStarted(): void {
		this.handoff.agentStarted();
	}

	piInput(
		input: unknown,
		streamingBehavior?: RealtimePiInputBehavior,
	): boolean {
		const routed = this.handoff.piInput(input, streamingBehavior);
		if (routed && streamingBehavior === undefined)
			this.endAfterResult = undefined;
		return routed;
	}

	piUserMessage(message: unknown): boolean {
		const consumed = this.handoff.piUserMessage(message);
		if (consumed) this.endAfterResult = undefined;
		return consumed;
	}

	streamAgentDelta(delta: string): void {
		if (!this.ending) this.handoff.stream(delta);
	}

	resumeAgentWork(): void {
		if (!this.ending) this.handoff.flushProgress();
	}

	agentProgress(content: string, reasoningSummary?: string): void {
		if (!this.ending) this.handoff.progress(content, reasoningSummary);
	}

	agentResult(
		content: string,
		stopReason: AssistantMessage["stopReason"],
	): void {
		if (this.ending) return;
		if (stopReason !== "stop") {
			this.handoff.progress(content);
			this.failDeferredEnding();
			return;
		}
		this.handoff.result(content);
		if (this.endAfterResult?.active && content.trim()) this.beginEnding(false);
	}

	settleAgentTurn(): void {
		this.failDeferredEnding();
		if (this.ending) {
			this.handoff.clear();
			return;
		}
		this.handoff.settle();
		if (!this.callbacks.hasPendingOutput()) this.callbacks.onListening();
	}

	private failDeferredEnding(): void {
		if (this.endAfterResult?.active) {
			this.endAfterResult = undefined;
			this.callbacks.sendContext(
				"speakable",
				"The requested answer did not complete. Tell the user it could not be finished and the call remains open; they can retry or stop the call.",
			);
		}
	}

	private beginEnding(finalOutputObserved: boolean): void {
		if (this.ending) return;
		this.endAfterResult = undefined;
		this.ending = true;
		this.endingOutput =
			this.callbacks.completedOutputs() + (finalOutputObserved ? 0 : 1);
		this.handoff.clear();
		this.callbacks.onEndCall();
	}
}
