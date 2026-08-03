import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { formatNativeBinaryError } from "../native-binary-error.ts";
import { resolveVoiceHelperBinary } from "./binary.ts";
import { BoundedJsonlReader, parseVoiceHelperEvent, type VoiceHelperCommand, type VoiceHelperEvent } from "./helper-protocol.ts";

export type { VoiceDevice, VoiceHelperCommand, VoiceHelperEvent } from "./helper-protocol.ts";
export { BoundedJsonlReader, parseVoiceHelperEvent } from "./helper-protocol.ts";

const MAX_HELPER_LINE_BYTES = 512 * 1024;
const READY_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_HELPER_STDIN_BYTES = 512 * 1024;

export class VoiceHelperClient {
	private child: ChildProcessWithoutNullStreams | undefined;
	private listeners = new Set<(event: VoiceHelperEvent) => void>();
	private exitListeners = new Set<(error: Error) => void>();
	private stdinFailures = new WeakSet<ChildProcessWithoutNullStreams>();
	private helperProtocolVersion: number | undefined;

	get protocolVersion(): number | undefined { return this.helperProtocolVersion; }

	onEvent(listener: (event: VoiceHelperEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async start(customRustBinariesDir?: string | undefined): Promise<void> {
		if (this.child) return;
		const binary = resolveVoiceHelperBinary(customRustBinariesDir);
		if (!binary) throw new Error(`Codex voice helper is not bundled for ${process.platform}-${process.arch}`);
		const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		this.child = child;
		const ready = Promise.withResolvers<void>();
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_192); });
		child.stdin.on("error", (error) => {
			const failure = new Error(formatNativeBinaryError("pi-codex-voice", stderr || error, {
				startupWriteFailure: this.helperProtocolVersion === undefined,
			}));
			ready.reject(failure);
			this.handleStdinError(child, failure);
		});
		const lines = new BoundedJsonlReader(MAX_HELPER_LINE_BYTES, (line) => {
			try {
				const event = parseVoiceHelperEvent(JSON.parse(line));
				if (event.type === "ready") {
					if (
						event.version === 2 ||
						event.version === 3 ||
						event.version === 4 ||
						event.version === 5
					) {
						this.helperProtocolVersion = event.version;
						ready.resolve();
					} else ready.reject(new Error(`Unsupported Codex voice helper protocol ${event.version}`));
				}
				for (const listener of this.listeners) listener(event);
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		}, () => {
			const error = new Error("Codex voice helper emitted an oversized event");
			ready.reject(error);
			this.fail(error);
			child.stdout.destroy();
			void this.close();
		});
		child.stdout.on("data", (chunk: Buffer) => lines.push(chunk));
		child.stdout.once("end", () => lines.end());
		child.once("error", (error) => {
			const failure = new Error(formatNativeBinaryError("pi-codex-voice", error, { binaryPath: binary }));
			ready.reject(failure);
			if (!this.stdinFailures.has(child)) this.fail(failure);
		});
		child.once("exit", (code, signal) => {
			const detail = stderr.trim();
			const raw = `Codex voice helper exited (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`;
			const error = new Error(formatNativeBinaryError("pi-codex-voice", raw));
			ready.reject(error);
			if (this.child === child) {
				this.child = undefined;
				this.helperProtocolVersion = undefined;
			}
			if (!this.stdinFailures.has(child)) this.fail(error);
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				ready.promise,
				new Promise<void>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error(`Codex voice helper did not become ready within ${READY_TIMEOUT_MS}ms`)), READY_TIMEOUT_MS);
				}),
			]);
		} catch (error) {
			await this.close();
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	send(command: VoiceHelperCommand): void {
		const child = this.child;
		if (!child?.stdin.writable) throw new Error("Codex voice helper is not running");
		const line = `${JSON.stringify(command)}\n`;
		if (child.stdin.writableLength + Buffer.byteLength(line) > MAX_HELPER_STDIN_BYTES) {
			const error = new Error("Codex voice helper input is backpressured");
			this.handleStdinError(child, error);
			throw error;
		}
		try {
			child.stdin.write(line, (error) => {
				if (error) this.handleStdinError(child, error);
			});
		} catch (error) {
			const writeError = error instanceof Error ? error : new Error(String(error));
			this.handleStdinError(child, writeError);
			throw writeError;
		}
	}

	async stop(): Promise<void> {
		if (!this.child) return;
		const stopped = Promise.withResolvers<void>();
		const removeEvent = this.onEvent((event) => {
			if (event.type === "stopped") stopped.resolve();
			else if (event.type === "error") stopped.reject(new Error(event.message));
		});
		const removeExit = this.onExit((error) => stopped.reject(error));
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			this.send({ type: "stop" });
			await Promise.race([
				stopped.promise,
				new Promise<void>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error("Codex voice helper did not stop")), STOP_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			removeEvent();
			removeExit();
		}
	}

	async close(): Promise<void> {
		const child = this.child;
		if (!child) return;
		this.child = undefined;
		this.helperProtocolVersion = undefined;
		if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
		if (await waitForExit(child, 2_000)) return;
		child.kill();
		if (await waitForExit(child, 1_000)) return;
		child.kill("SIGKILL");
		await waitForExit(child, 1_000);
	}

	private fail(error: Error): void {
		for (const listener of this.exitListeners) listener(error);
	}

	private handleStdinError(child: ChildProcessWithoutNullStreams, error: Error): void {
		if (this.stdinFailures.has(child)) return;
		this.stdinFailures.add(child);
		if (this.child !== child) return;
		this.child = undefined;
		this.helperProtocolVersion = undefined;
		child.kill();
		this.fail(error);
	}
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timeout = setTimeout(() => { child.off("exit", onExit); resolve(false); }, timeoutMs);
		const onExit = () => { clearTimeout(timeout); resolve(true); };
		child.once("exit", onExit);
	});
}
