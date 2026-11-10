import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerSpawnAncestry } from "./ancestry-record.js";

export const WORKER_FLAG = "shepherdr-worker";
const WORKER_MARKER = "herdr-worker-v1";
const WORKER_ROLE_CHANNEL = "shepherdr:worker-role:v1";

type SessionManager = ExtensionContext["sessionManager"];

/** Optional synchronous event request; consumers need no Shepherdr import. */
interface WorkerRoleRequest {
	sessionManager: SessionManager;
	reply: (worker: boolean) => void;
}

export function markedWorker(manager: SessionManager): boolean {
	const sessionId = manager.getSessionId();
	return manager.getEntries().some((entry) => {
		if (entry.type !== "custom" || entry.customType !== WORKER_MARKER)
			return false;
		const data = entry.data as { sessionId?: unknown } | undefined;
		return data?.sessionId === sessionId;
	});
}

export function registerWorkerRole(pi: ExtensionAPI) {
	registerSpawnAncestry(pi);
	pi.registerFlag(WORKER_FLAG, {
		type: "boolean",
		default: false,
		description: "Run as a supervised Shepherdr worker",
	});
	const isWorker = (manager: SessionManager) =>
		pi.getFlag(WORKER_FLAG) === true || markedWorker(manager);
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
		if (pi.getFlag(WORKER_FLAG) === true && !markedWorker(ctx.sessionManager)) {
			// Startup entries would prevent fresh Notes family adoption before work.
			pi.appendEntry(WORKER_MARKER, {
				sessionId: ctx.sessionManager.getSessionId(),
			});
		}
	});
	return { isWorker };
}
