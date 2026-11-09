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

interface SettlementWaiter {
	cleanup(): void;
	reject(error: Error): void;
	resolve(settlement: ClaimedSettlement): void;
}

type SettlementClaim =
	| { replyingTo: ExtensionReply; waiter?: SettlementWaiter }
	| { replyingTo?: ExtensionReply; waiter: SettlementWaiter };

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
	observeReply(attempt: WorkAttempt, reply: ExtensionReply): void {
		const claim = this.claims.get(attempt.attemptId);
		this.claims.set(attempt.attemptId, {
			...(claim?.waiter ? { waiter: claim.waiter } : {}),
			replyingTo: reply,
		});
	}
	stop() {
		for (const claim of this.claims.values()) {
			claim.waiter?.cleanup();
			claim.waiter?.reject(new Error("Shepherdr monitor stopped"));
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
		const existing = this.claims.get(attempt.attemptId);
		if (existing?.waiter) return;
		const reply = replyingTo ?? existing?.replyingTo;
		return new Promise<ClaimedSettlement>((resolve, reject) => {
			const abort = () => {
				const claim = this.claims.get(attempt.attemptId);
				if (!claim) return;
				this.claims.delete(attempt.attemptId);
				claim.waiter?.cleanup();
				reject(
					signal.reason instanceof Error
						? signal.reason
						: new Error("Shepherdr wait aborted"),
				);
			};
			const claim: SettlementClaim = {
				...(reply ? { replyingTo: reply } : {}),
				waiter: {
					cleanup: () => signal.removeEventListener("abort", abort),
					reject,
					resolve,
				},
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
		claim.waiter?.cleanup();
		claim.waiter?.reject(
			error instanceof Error ? error : new Error(String(error)),
		);
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
		}
		if (claim?.waiter) {
			claim.waiter.cleanup();
			const {
				reply: _latestReply,
				session: _session,
				...claimedSettlement
			} = settlement;
			claim.waiter.resolve({
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
