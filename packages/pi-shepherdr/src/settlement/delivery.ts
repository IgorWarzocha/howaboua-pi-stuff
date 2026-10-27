import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activityAttemptId } from "../activity.js";
import { injectAgentEvent } from "../messages/events.js";
import type { WorkAttempt } from "../monitor-state.js";
import type {
	ExtensionReply,
	LatestAssistant,
	MonitoredAgent,
} from "../types.js";
import type {
	CollectedSettlement,
	CollectedSettlementWithSession,
} from "./collector.js";
import type { SettlementLifecycle } from "./index.js";

export interface ClaimedSettlement extends CollectedSettlement {
	blockedMessage?: string;
	record: MonitoredAgent;
}

interface SettlementClaim {
	replyingTo?: ExtensionReply;
	cleanup(): void;
	reject(error: Error): void;
	resolve(settlement: ClaimedSettlement): void;
}

/** Claims are per-attempt capabilities; delivery chooses exactly one waiter or controller. */
export class SettlementDelivery {
	private readonly claims = new Map<string, SettlementClaim>();
	private readonly pi: ExtensionAPI;
	private readonly origin: {
		machine: string;
		label: () => string;
		operatorPrefix: string;
	};
	constructor(
		pi: ExtensionAPI,
		origin: { machine: string; label: () => string; operatorPrefix: string },
	) {
		this.pi = pi;
		this.origin = origin;
	}
	replyingTo(attemptId: string) {
		return this.claims.get(attemptId)?.replyingTo;
	}
	stop() {
		for (const claim of this.claims.values()) {
			claim.cleanup();
			claim.reject(new Error("Shepherdr monitor stopped"));
		}
		this.claims.clear();
	}
	claim(
		attempt: WorkAttempt,
		signal: AbortSignal,
		replyingTo?: ExtensionReply,
	): Promise<ClaimedSettlement> | undefined {
		signal.throwIfAborted();
		// Updates share the worker's current settlement, without stealing its waiter.
		if (this.claims.has(attempt.attemptId)) return;
		return new Promise<ClaimedSettlement>((resolve, reject) => {
			const abort = () => {
				const claim = this.claims.get(attempt.attemptId);
				if (!claim) return;
				this.claims.delete(attempt.attemptId);
				claim.cleanup();
				reject(
					signal.reason instanceof Error
						? signal.reason
						: new Error("Shepherdr wait aborted"),
				);
			};
			const claim: SettlementClaim = {
				...(replyingTo ? { replyingTo } : {}),
				cleanup: () => signal.removeEventListener("abort", abort),
				reject,
				resolve,
			};
			this.claims.set(attempt.attemptId, claim);
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	releaseClaim(attempt: WorkAttempt | undefined, error: unknown): void {
		if (!attempt) return;
		this.releaseAttempt(attempt.attemptId, error);
	}

	releaseAgentClaim(record: MonitoredAgent, error: unknown): void {
		const attemptId = activityAttemptId(record.activity);
		if (attemptId) this.releaseAttempt(attemptId, error);
	}

	releaseAttempt(attemptId: string, error: unknown): void {
		const claim = this.claims.get(attemptId);
		if (!claim) return;
		this.claims.delete(attemptId);
		claim.cleanup();
		claim.reject(error instanceof Error ? error : new Error(String(error)));
	}

	deliverSettlement(
		lifecycle: SettlementLifecycle,
		record: MonitoredAgent,
		settlement: CollectedSettlementWithSession,
		attemptId: string | undefined,
		blockedMessage: string | undefined,
		reply: LatestAssistant | undefined,
	): void {
		const claim = attemptId ? this.claims.get(attemptId) : undefined;
		if (claim && attemptId) {
			this.claims.delete(attemptId);
			claim.cleanup();
			const {
				reply: _latestReply,
				session: _session,
				...claimedSettlement
			} = settlement;
			claim.resolve({
				...claimedSettlement,
				record,
				...(blockedMessage ? { blockedMessage } : {}),
				...(reply ? { reply } : {}),
			});
			return;
		}
		injectAgentEvent(this.pi, lifecycle.context, {
			agent: settlement.agent,
			agentToolName: "agents",
			...(settlement.extensionMessages
				? { extensionMessages: settlement.extensionMessages }
				: {}),
			machine: this.origin.machine,
			machineLabel: this.origin.label(),
			operatorPrefix: this.origin.operatorPrefix,
			...(blockedMessage ? { blockedMessage } : {}),
			labels: settlement.labels,
			record,
			...(reply ? { reply } : {}),
			status: settlement.status,
		});
	}
}
