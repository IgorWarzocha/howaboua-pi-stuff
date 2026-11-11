import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	WorkerService,
	WorkerStatus,
} from "@howaboua/pi-shepherdr/worker-api";

const WORKER_PROTOCOL: WorkerService["protocol"] =
	"@howaboua/pi-shepherdr/workers/v1";
const PULSE_SCOPE = "@howaboua/pi-pulses";
export interface PulseRun {
	taskId: string;
	title: string;
	prompt: string;
	cwd: string;
	runId: string;
	workerId?: string;
}
/** Only this positive receipt permits clearing an admission after start rejects. */
export function isPulseRunNotStarted(
	error: unknown,
): error is Error & { dispatched: false } {
	return (
		error instanceof Error &&
		"dispatched" in error &&
		error.dispatched === false
	);
}
/** Detached workers only. The runner delivers final assistant results through its waking launcher path. */
export interface PulseRunner {
	id: string;
	/** Pulses schedules only in TUI sessions that are not workers. */
	isController(ctx: ExtensionContext): boolean;
	/** Admission only, never completion. Rejections are uncertain unless dispatched:false proves this run never started. */
	start(ctx: ExtensionContext, input: PulseRun): Promise<WorkerStatus>;
	inspect(ctx: ExtensionContext, workerId: string): Promise<WorkerStatus>;
	subscribe(listener: () => void): () => void;
}

/** Subscriptions may precede operational readiness. Check isController before scheduling or claiming. */
export function connectPulseRunner(pi: ExtensionAPI) {
	let disposed = false;
	return {
		get service(): PulseRunner | undefined {
			if (disposed) return undefined;
			const runners = new Set<WorkerService>();
			pi.events.emit(`${WORKER_PROTOCOL}/request`, {
				protocol: WORKER_PROTOCOL,
				accept(value: WorkerService) {
					if (
						value?.protocol === WORKER_PROTOCOL &&
						typeof value.id === "string" &&
						value.id &&
						[value.isWorker, value.start, value.inspect, value.subscribe].every(
							(fn) => typeof fn === "function",
						)
					)
						runners.add(value);
				},
			});
			if (runners.size > 1)
				throw new Error(
					"Multiple worker services are available. Enable one before scheduling pulses.",
				);
			const service = runners.values().next().value;
			if (!service) return undefined;
			return {
				id: service.id,
				isController: (ctx) => ctx.mode === "tui" && !service.isWorker(ctx),
				start: (ctx, input) =>
					service.start(ctx, {
						scope: PULSE_SCOPE,
						key: input.taskId,
						requestId: input.runId,
						title: input.title,
						prompt: input.prompt,
						cwd: input.cwd,
						...(input.workerId ? { workerId: input.workerId } : {}),
						lifetime: "detached",
					}),
				inspect: (ctx, workerId) => service.inspect(ctx, PULSE_SCOPE, workerId),
				subscribe: (listener) => service.subscribe(listener),
			};
		},
		dispose() {
			disposed = true;
		},
	};
}
