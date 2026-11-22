import { Worker } from "node:worker_threads";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import { startBunVmProcess } from "./bun-process.ts";
import type {
	VmCommand,
	VmInput,
	VmMemory,
	VmMessage,
	VmOutcome,
} from "./protocol.ts";

interface Callbacks {
	output(items: RuntimeContentItem[]): void;
	notify(text: string): void;
	yield(): void;
	store(key: string, json?: string): void;
	request(id: number, name: string, value: unknown): Promise<unknown>;
	cancel(): void;
}

interface VmEndpoint {
	postMessage(command: VmCommand): void;
	stop(): Promise<void>;
}

/** One worker owns one VM context. Stop terminates its worker or capped process. */
export class VmKernel {
	private readonly endpoint: VmEndpoint;
	private next = 0;
	private active:
		| {
				run: number;
				callbacks: Callbacks;
				resolve(value: VmOutcome): void;
				reject(error: Error): void;
		  }
		| undefined;
	private failure: Error | undefined;
	private stopping: Promise<void> | undefined;
	private sampleWait: ((memory: VmMemory) => void) | undefined;

	static create(heapMiB: number): VmKernel {
		return new VmKernel(heapMiB);
	}

	private constructor(heapMiB: number) {
		const deliver = (message: VmMessage) => this.deliver(message);
		this.endpoint = process.versions["bun"]
			? startBunVmProcess(heapMiB, deliver, (error) =>
					this.fail(error ?? workerFailure()),
				)
			: startNodeVmWorker(heapMiB, deliver, (error) =>
					this.fail(workerFailure(error)),
				);
	}

	get failed(): boolean {
		return this.failure !== undefined || this.stopping !== undefined;
	}

	execute(input: VmInput, callbacks: Callbacks): Promise<VmOutcome> {
		if (this.failure || this.stopping)
			return Promise.reject(this.failure ?? new Error("VM Code is stopping"));
		if (this.active)
			return Promise.reject(new Error("VM Code is still running an exec"));
		return new Promise((resolve, reject) => {
			const run = ++this.next;
			this.active = { run, callbacks, resolve, reject };
			this.endpoint.postMessage({ kind: "run", run, input });
		});
	}

	sample(): Promise<VmMemory> {
		if (this.failure || this.stopping)
			return Promise.reject(this.failure ?? new Error("VM Code is stopping"));
		return new Promise((resolve) => {
			this.sampleWait = resolve;
			this.endpoint.postMessage({ kind: "sample" });
		});
	}

	async stop(): Promise<void> {
		this.stopping ??= this.endpoint.stop();
		await this.stopping;
	}

	private deliver(message: VmMessage): void {
		if (message.kind === "sample") {
			this.sampleWait?.(message.memory);
			this.sampleWait = undefined;
			return;
		}
		const active = this.active;
		if (!active || message.run !== active.run) return;
		try {
			switch (message.kind) {
				case "output":
					active.callbacks.output(message.items);
					break;
				case "notify":
					active.callbacks.notify(message.text);
					break;
				case "yield":
					active.callbacks.yield();
					break;
				case "store":
					active.callbacks.store(message.key, message.json);
					break;
				case "call":
					void this.request(message, active);
					break;
				case "cancel":
					active.callbacks.cancel();
					break;
				case "done":
					this.active = undefined;
					active.resolve(message.outcome);
					break;
			}
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			void this.stop();
		}
	}

	private fail(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		this.active?.reject(error);
		this.active = undefined;
		this.sampleWait = undefined;
	}

	private async request(
		message: Extract<VmMessage, { kind: "call" }>,
		active: NonNullable<VmKernel["active"]>,
	): Promise<void> {
		let reply: VmCommand;
		try {
			const result = await active.callbacks.request(
				message.id,
				message.name,
				message.json === "" ? undefined : JSON.parse(message.json),
			);
			const json = result === undefined ? "" : JSON.stringify(result);
			if (typeof json !== "string")
				throw new Error(
					"This tool result cannot be represented as JSON in VM Code",
				);
			if (json.length > VM_RESULT_MAX)
				throw new Error(
					"Tool result exceeds the VM Code limit; request less data",
				);
			reply = { kind: "reply", run: message.run, id: message.id, json };
		} catch (error) {
			reply = {
				kind: "reply",
				run: message.run,
				id: message.id,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		if (!this.stopping && this.active?.run === message.run)
			this.endpoint.postMessage(reply);
	}
}

const VM_RESULT_MAX = 32 * 1024 * 1024;

function startNodeVmWorker(
	heapMiB: number,
	deliver: (message: VmMessage) => void,
	fail: (error?: Error) => void,
): VmEndpoint {
	const entry = import.meta.url.endsWith(".ts")
		? new URL("./worker.ts", import.meta.url)
		: new URL("./worker.js", import.meta.url);
	const worker = new Worker(entry, {
		resourceLimits: {
			maxOldGenerationSizeMb: heapMiB,
			maxYoungGenerationSizeMb: Math.min(32, heapMiB),
			stackSizeMb: 4,
		},
		execArgv: [
			"--experimental-vm-modules",
			"--disable-warning=ExperimentalWarning",
		],
		stdout: true,
		stderr: true,
	});
	worker.stdout.resume();
	worker.stderr.resume();
	worker.on("message", deliver);
	worker.once("error", (error) =>
		fail(error instanceof Error ? error : new Error(String(error))),
	);
	worker.once("exit", () => fail());
	return {
		postMessage: (command) => worker.postMessage(command),
		stop: () => worker.terminate().then(() => undefined),
	};
}

function workerFailure(error?: Error): Error {
	return error && /out of memory|memory limit/i.test(error.message)
		? new Error(
				"VM Code hit its memory limit and dropped conversation bindings. The next exec starts fresh",
				{ cause: error },
			)
		: new Error(
				"VM Code stopped and dropped conversation bindings. The next exec starts fresh",
				{ cause: error },
			);
}
