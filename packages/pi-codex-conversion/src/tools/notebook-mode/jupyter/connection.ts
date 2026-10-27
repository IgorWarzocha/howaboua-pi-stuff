import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createJupyterConnectionFile, type JupyterConnectionInfo } from "../jupyter-connection.ts";
import { JupyterSocket } from "../jupyter-socket.ts";
import { withNotebookRecoveryGuidance } from "../runtime-health.ts";
import { createJupyterMessage, decodeJupyterMessage, encodeJupyterMessage, type JupyterMessage } from "../jupyter-wire.ts";
import { JupyterShellChannel, withJupyterTimeout as withTimeout } from "./shell-channel.ts";

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SHUTDOWN_GRACE_MS = 1_500;
const MAX_STDERR_CHARS = 16_384;

export class JupyterKernelConnection {
	private readonly deno: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly maxHeapMiB: number;
	private readonly session: string;
	private readonly onFailure: (error: Error) => void;
	private readonly onOutput: (message: JupyterMessage) => void;
	private process: ChildProcess | undefined;
	private tempDir: string | undefined;
	private connection: JupyterConnectionInfo | undefined;
	private shell: JupyterShellChannel | undefined;
	private control: JupyterSocket | undefined;
	private iopub: JupyterSocket | undefined;
	private iopubPump: Promise<void> | undefined;
	private startup: Promise<void> | undefined;
	private stderr = "";

	constructor(options: {
		deno: string;
		maxHeapMiB: number;
		env: NodeJS.ProcessEnv;
		session: string;
		onFailure: (error: Error) => void;
		onOutput: (message: JupyterMessage) => void;
	}) {
		this.deno = options.deno;
		this.env = options.env;
		this.maxHeapMiB = options.maxHeapMiB;
		this.session = options.session;
		this.onFailure = options.onFailure;
		this.onOutput = options.onOutput;
	}

	start(signal?: AbortSignal): Promise<void> {
		if (!this.startup) this.startup = this.startInner(signal).catch((error) => {
			this.startup = undefined;
			this.dispose();
			throw error;
		});
		return this.startup;
	}

	async interrupt(): Promise<void> {
		if (!this.control || !this.connection) return;
		const message = createJupyterMessage("interrupt_request", {}, this.session);
		await this.control.send(encodeJupyterMessage(message, this.connection.key));
	}

	async shutdown(): Promise<void> {
		const process = this.process;
		const pumps = [this.shell?.pump, this.iopubPump].filter((pump): pump is Promise<void> => Boolean(pump));
		if (this.control && this.connection) {
			try {
				const message = createJupyterMessage("shutdown_request", { restart: false }, this.session);
				await withTimeout(
					this.control.send(encodeJupyterMessage(message, this.connection.key)),
					SHUTDOWN_GRACE_MS,
					() => new Error(`Deno Jupyter could not send shutdown_request within ${SHUTDOWN_GRACE_MS}ms`),
				);
			} catch {
				// Process termination below is the fallback.
			}
		}
		if (process?.exitCode === null && process.signalCode === null) {
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		if (process?.exitCode === null && process.signalCode === null) {
			process.kill("SIGTERM");
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		if (process?.exitCode === null && process.signalCode === null) {
			process.kill("SIGKILL");
			await waitForProcessExit(process, SHUTDOWN_GRACE_MS);
		}
		this.dispose();
		await withTimeout(
			Promise.allSettled(pumps),
			SHUTDOWN_GRACE_MS,
			() => new Error(`Deno Jupyter socket pumps did not stop within ${SHUTDOWN_GRACE_MS}ms`),
		).catch(() => undefined);
		this.iopubPump = undefined;
	}

	private async startInner(signal?: AbortSignal): Promise<void> {
		if (this.process && this.connection) return;
		signal?.throwIfAborted();
		const { info, path, dir } = await createJupyterConnectionFile();
		this.tempDir = dir;
		const child = spawn(this.deno, ["jupyter", "--kernel", "--conn", path], {
			cwd: dir,
			env: {
				...this.env,
				DENO_NO_PACKAGE_JSON: "1",
				DENO_V8_FLAGS: [this.env["DENO_V8_FLAGS"], `--max-old-space-size=${this.maxHeapMiB}`]
					.filter(Boolean)
					.join(" "),
			},
			stdio: ["ignore", "ignore", "pipe"],
		});
		this.process = child;
		child.stderr?.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString()}`.slice(-MAX_STDERR_CHARS);
		});
		child.on("error", (error) => this.onFailure(new Error(`Deno Jupyter process failed: ${error.message}`)));
		child.on("exit", (code, childSignal) => {
			if (this.process !== child) return;
			this.onFailure(new Error(withNotebookRecoveryGuidance(`Notebook runtime exited unexpectedly (${childSignal ? `signal ${childSignal}` : `exit code ${code ?? "unknown"}`})`), { cause: new Error(this.stderr) }));
		});
		const connection = info;
		this.connection = connection;
		this.shell = new JupyterShellChannel(connection, this.session, this.onFailure, () => this.stderr);
		this.control = new JupyterSocket("DEALER", connection.control_port);
		this.iopub = new JupyterSocket("SUB", connection.iopub_port);
		await Promise.all([this.shell.connect(signal), this.control.connect(signal), this.iopub.connect(signal)]);
		this.shell.startPump();
		let markIopubReady!: () => void;
		const iopubReady = new Promise<void>((resolve) => { markIopubReady = resolve; });
		this.iopubPump = this.runIopubPump(markIopubReady);
		await this.waitForKernelReady(iopubReady, signal);
	}

	private async waitForKernelReady(iopubReady: Promise<void>, signal?: AbortSignal): Promise<void> {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		while (true) {
			signal?.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				throw new Error(withNotebookRecoveryGuidance(`Notebook runtime did not become ready within ${STARTUP_TIMEOUT_MS}ms`), { cause: new Error(this.stderr) });
			}
			await this.shellRequest("kernel_info_request", {}, remaining, signal);
			const ready = await Promise.race([
				iopubReady.then(() => true),
				sleep(Math.min(100, remaining), false, signal ? { signal } : undefined),
			]);
			if (ready) return;
		}
	}

	async shellRequest(
		type: string,
		content: Record<string, unknown>,
		timeoutMs = REQUEST_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error(withNotebookRecoveryGuidance("Notebook runtime is disconnected"));
		return shell.request(type, content, timeoutMs, signal);
	}

	async sendShellRequest(request: JupyterMessage, timeoutMs?: number, requestType = "request", signal?: AbortSignal): Promise<JupyterMessage> {
		if (!this.shell || !this.connection) throw new Error(withNotebookRecoveryGuidance("Notebook runtime is disconnected"));
		return this.shell.sendShellRequest(request, timeoutMs, requestType, signal);
	}

	private async runIopubPump(markReady?: () => void): Promise<void> {
		const socket = this.iopub;
		const connection = this.connection;
		if (!socket || !connection) return;
		try {
			for await (const frames of socket) {
				const message = decodeJupyterMessage([...frames] as Buffer[], connection.key);
				if (message) {
					markReady?.();
					markReady = undefined;
					this.onOutput(message);
				}
			}
		} catch (error) {
			if (this.iopub === socket) this.onFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}

	dispose(): void {
		const child = this.process;
		this.process = undefined;
		if (child?.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			const killTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, SHUTDOWN_GRACE_MS);
			killTimer.unref?.();
			child.once("exit", () => clearTimeout(killTimer));
		}
		const shell = this.shell;
		this.shell = undefined;
		shell?.close();
		this.control?.close();
		this.iopub?.close();
		this.control = undefined;
		this.iopub = undefined;
		this.connection = undefined;
		this.startup = undefined;
		if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true });
		this.tempDir = undefined;
	}
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<void> {
	if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(finish, timeoutMs);
		const exited = () => finish();
		function finish() {
			clearTimeout(timer);
			process.off("exit", exited);
			resolve();
		}
		process.once("exit", exited);
	});
}
