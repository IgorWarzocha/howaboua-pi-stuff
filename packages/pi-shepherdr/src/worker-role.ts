import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const WORKER_FLAG = "shepherdr-worker";
export const PULSE_WORKER_FLAG = "shepherdr-pulse-worker";
const WORKER_MARKER = "herdr-worker-v1";
const LEGACY_PULSE_MARKER = "herdr-pulse-worker-v1";
const WORKER_ROLE_CHANNEL = "shepherdr:worker-role:v1";

type SessionManager = ExtensionContext["sessionManager"];

/** Optional synchronous event request; consumers need no Shepherdr import. */
interface WorkerRoleRequest {
	sessionManager: SessionManager;
	reply: (worker: boolean) => void;
}

function markedWorker(manager: SessionManager, pulseOnly = false): boolean {
	const sessionId = manager.getSessionId();
	return manager.getEntries().some((entry) => {
		if (
			entry.type !== "custom" ||
			(entry.customType !== WORKER_MARKER &&
				entry.customType !== LEGACY_PULSE_MARKER)
		)
			return false;
		const data = entry.data as
			| { sessionId?: unknown; pulse?: unknown }
			| undefined;
		return (
			data?.sessionId === sessionId &&
			(!pulseOnly ||
				entry.customType === LEGACY_PULSE_MARKER ||
				data.pulse === true)
		);
	});
}

export function registerWorkerRole(pi: ExtensionAPI) {
	pi.registerFlag(WORKER_FLAG, {
		type: "boolean",
		default: false,
		description: "Run as a supervised Shepherdr worker",
	});
	pi.registerFlag(PULSE_WORKER_FLAG, {
		type: "boolean",
		default: false,
		description: "Run as a detached pulse worker",
	});
	const isWorker = (manager: SessionManager) =>
		pi.getFlag(WORKER_FLAG) === true ||
		pi.getFlag(PULSE_WORKER_FLAG) === true ||
		markedWorker(manager);
	const isPulseWorker = (manager: SessionManager) =>
		pi.getFlag(PULSE_WORKER_FLAG) === true || markedWorker(manager, true);
	// Read the supplied native session directly, even before our session_start.
	pi.events.on(WORKER_ROLE_CHANNEL, (request: unknown) => {
		const value = request as Partial<WorkerRoleRequest> | undefined;
		if (
			typeof value?.reply === "function" &&
			typeof value.sessionManager?.getSessionId === "function" &&
			typeof value.sessionManager.getEntries === "function"
		)
			value.reply(isWorker(value.sessionManager));
	});
	pi.on("before_agent_start", (_event, ctx) => {
		const pulse = pi.getFlag(PULSE_WORKER_FLAG) === true;
		if (
			(pi.getFlag(WORKER_FLAG) === true || pulse) &&
			(!markedWorker(ctx.sessionManager) ||
				(pulse && !markedWorker(ctx.sessionManager, true)))
		) {
			// Startup entries would prevent fresh Notes family adoption before work.
			pi.appendEntry(WORKER_MARKER, {
				sessionId: ctx.sessionManager.getSessionId(),
				...(pulse ? { pulse: true } : {}),
			});
		}
	});
	return { isWorker, isPulseWorker };
}
