import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { formatNativeBinaryError } from "../native-binary-error.ts";
import { resolveVoiceHelperBinary } from "./binary.ts";
import { MAX_REALTIME_SDP_BYTES } from "./conversation/peer.ts";

export type VoiceHelperCommand =
	| { type: "list_devices" }
	| { type: "start_v3"; microphone?: string; speaker?: string }
	| { type: "start_v3_bridge" }
	| { type: "set_input_muted"; muted: boolean }
	| { type: "apply_answer"; sdp: string }
	| { type: "start_dictation"; microphone?: string }
	| { type: "send_data"; message: unknown }
	| { type: "send_pcm"; audio: string; sample_rate: 24_000; num_channels: 1 }
	| { type: "stop" }
	| { type: "shutdown" };

export type VoiceHelperEvent =
	| { type: "ready"; version: number }
	| { type: "devices"; inputs: VoiceDevice[]; outputs: VoiceDevice[] }
	| { type: "offer"; sdp: string }
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "pcm"; audio: string; sample_rate: number; num_channels: number }
	| { type: "error"; message: string }
	| { type: "stopped" };

export interface VoiceDevice {
	id: string;
	name: string;
	is_default: boolean;
}

const MAX_HELPER_LINE_BYTES = 512 * 1024;
const MAX_PCM_BYTES = 64 * 1024;
const MAX_DATA_MESSAGE_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_DEVICE_BYTES = 512;
const MAX_DEVICES = 128;
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

export class BoundedJsonlReader {
	private readonly chunks: Buffer[] = [];
	private readonly maxLineBytes: number;
	private readonly onLine: (line: string) => void;
	private readonly onOversized: () => void;
	private byteLength = 0;
	private failed = false;

	constructor(
		maxLineBytes: number,
		onLine: (line: string) => void,
		onOversized: () => void,
	) {
		this.maxLineBytes = maxLineBytes;
		this.onLine = onLine;
		this.onOversized = onOversized;
	}

	push(chunk: Buffer): void {
		if (this.failed) return;
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline === -1 ? chunk.length : newline;
			if (!this.append(chunk.subarray(offset, end))) return;
			if (newline === -1) return;
			this.emitLine();
			offset = newline + 1;
		}
	}

	end(): void {
		if (!this.failed && this.byteLength > 0) this.emitLine();
	}

	private append(chunk: Buffer): boolean {
		if (this.byteLength + chunk.length > this.maxLineBytes) {
			this.failed = true;
			this.chunks.length = 0;
			this.byteLength = 0;
			this.onOversized();
			return false;
		}
		if (chunk.length > 0) {
			this.chunks.push(Buffer.from(chunk));
			this.byteLength += chunk.length;
		}
		return true;
	}

	private emitLine(): void {
		let line = this.chunks.length === 1
			? this.chunks[0]!
			: Buffer.concat(this.chunks, this.byteLength);
		this.chunks.length = 0;
		this.byteLength = 0;
		if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
		this.onLine(line.toString("utf8"));
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

export function parseVoiceHelperEvent(value: unknown): VoiceHelperEvent {
	if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") throw new Error("Invalid Codex voice helper event");
	const event = value as Record<string, unknown>;
	if (event["type"] === "ready" && Number.isSafeInteger(event["version"])) return event as VoiceHelperEvent;
	if (event["type"] === "devices" && validDevices(event["inputs"]) && validDevices(event["outputs"])) return event as VoiceHelperEvent;
	if (event["type"] === "offer" && boundedString(event["sdp"], MAX_REALTIME_SDP_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "state" && boundedString(event["state"], 128)) return event as VoiceHelperEvent;
	if (event["type"] === "data" && boundedJson(event["message"], MAX_DATA_MESSAGE_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "pcm" && validBase64(event["audio"], MAX_PCM_BYTES) && event["sample_rate"] === 24_000 && event["num_channels"] === 1) return event as VoiceHelperEvent;
	if (event["type"] === "error" && boundedString(event["message"], MAX_TEXT_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "stopped") return event as VoiceHelperEvent;
	throw new Error(`Invalid Codex voice helper ${event["type"]} event`);
}

function validDevices(value: unknown): value is VoiceDevice[] {
	return Array.isArray(value) && value.length <= MAX_DEVICES && value.every((item) => {
		if (!item || typeof item !== "object") return false;
		const device = item as Record<string, unknown>;
		return boundedString(device["id"], MAX_DEVICE_BYTES)
			&& boundedString(device["name"], MAX_DEVICE_BYTES)
			&& typeof device["is_default"] === "boolean";
	});
}

function boundedString(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && Buffer.byteLength(value) <= maxBytes;
}

function boundedJson(value: unknown, maxBytes: number): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	try {
		return Buffer.byteLength(JSON.stringify(value)) <= maxBytes;
	} catch {
		return false;
	}
}

function validBase64(value: unknown, maxBytes: number): value is string {
	return boundedString(value, maxBytes)
		&& value.length > 0
		&& /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
