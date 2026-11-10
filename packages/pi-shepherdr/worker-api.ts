import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const WORKER_PROTOCOL = "@howaboua/pi-shepherdr/workers/v1";

export interface WorkerStart {
	scope: string;
	key: string;
	requestId: string;
	title: string;
	prompt: string;
	cwd: string;
	workerId?: string;
	lifetime?: "parent" | "detached";
}

export interface WorkerStatus {
	workerId: string;
	state: "working" | "idle" | "closed";
}

/** Discover through `${WORKER_PROTOCOL}/request` with { protocol, accept(service) }.
 * Scheduling and controller eligibility belong to callers, not this service.
 */
export interface WorkerService {
	protocol: typeof WORKER_PROTOCOL;
	id: string;
	isWorker(ctx: ExtensionContext): boolean;
	/** Admission only. Never retry an uncertain rejection, even with the same requestId.
	 * Only dispatched:false proves no submission. Inspection does not clear uncertainty.
	 */
	start(ctx: ExtensionContext, input: WorkerStart): Promise<WorkerStatus>;
	inspect(
		ctx: ExtensionContext,
		scope: string,
		workerId: string,
	): Promise<WorkerStatus>;
	subscribe(listener: () => void): () => void;
}
