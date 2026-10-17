import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const PULSE_RUNNER_PROTOCOL = "@howaboua/pi-pulses/runner/v1";
export interface PulseRun {
	taskId: string;
	title: string;
	prompt: string;
	cwd: string;
	runId: string;
	workerId?: string;
}
export interface PulseWorker {
	workerId: string;
	state: "working" | "idle" | "closed";
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
	protocol: typeof PULSE_RUNNER_PROTOCOL;
	id: string;
	/** False in detached workers, including resumed workers; callable before readiness. */
	isController(ctx: ExtensionContext): boolean;
	/** Admission only, never completion. Rejections are uncertain unless dispatched:false proves this run never started. */
	start(ctx: ExtensionContext, input: PulseRun): Promise<PulseWorker>;
	inspect(ctx: ExtensionContext, workerId: string): Promise<PulseWorker>;
	subscribe(listener: () => void): () => void;
}

/** Subscriptions may precede operational readiness. Check isController before scheduling or claiming. */
export function connectPulseRunner(pi: ExtensionAPI) {
	let disposed = false;
	return {
		get service(): PulseRunner | undefined {
			if (disposed) return undefined;
			const runners = new Set<PulseRunner>();
			pi.events.emit(`${PULSE_RUNNER_PROTOCOL}/request`, {
				protocol: PULSE_RUNNER_PROTOCOL,
				accept(value: PulseRunner) {
					if (
						value?.protocol === PULSE_RUNNER_PROTOCOL &&
						typeof value.id === "string" &&
						value.id &&
						[
							value.isController,
							value.start,
							value.inspect,
							value.subscribe,
						].every((fn) => typeof fn === "function")
					)
						runners.add(value);
				},
			});
			if (runners.size > 1)
				throw new Error(
					"Multiple pulse runners are available. Enable one runner before scheduling.",
				);
			return runners.values().next().value;
		},
		dispose() {
			disposed = true;
		},
	};
}
