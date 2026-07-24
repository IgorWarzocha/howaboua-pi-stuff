import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveVoiceHelperBinary } from "./binary.ts";

export type VoiceHelperCommand =
	| { type: "list_devices" }
	| { type: "start_v3"; microphone?: string; speaker?: string }
	| { type: "apply_answer"; sdp: string }
	| { type: "start_dictation"; microphone?: string }
	| { type: "send_data"; message: unknown }
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
const MAX_SDP_BYTES = 256 * 1024;
const MAX_PCM_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_DEVICE_BYTES = 512;
const MAX_DEVICES = 128;
const READY_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 2_000;

export class VoiceHelperClient {
	private child: ChildProcessWithoutNullStreams | undefined;
	private listeners = new Set<(event: VoiceHelperEvent) => void>();
	private exitListeners = new Set<(error: Error) => void>();

	onEvent(listener: (event: VoiceHelperEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async start(): Promise<void> {
		if (this.child) return;
		const binary = resolveVoiceHelperBinary();
		if (!binary) throw new Error(`Codex voice helper is not bundled for ${process.platform}-${process.arch}`);
		const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		this.child = child;
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_192); });
		const ready = Promise.withResolvers<void>();
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		lines.on("line", (line) => {
			if (Buffer.byteLength(line) > MAX_HELPER_LINE_BYTES) {
				this.fail(new Error("Codex voice helper emitted an oversized event"));
				return;
			}
			try {
				const event = parseVoiceHelperEvent(JSON.parse(line));
				if (event.type === "ready") event.version === 2 ? ready.resolve() : ready.reject(new Error(`Unsupported Codex voice helper protocol ${event.version}`));
				for (const listener of this.listeners) listener(event);
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		child.once("error", (error) => { ready.reject(error); this.fail(error); });
		child.once("exit", (code, signal) => {
			const detail = stderr.trim();
			const error = new Error(`Codex voice helper exited (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`);
			ready.reject(error);
			this.child = undefined;
			this.fail(error);
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
		if (!this.child?.stdin.writable) throw new Error("Codex voice helper is not running");
		this.child.stdin.write(`${JSON.stringify(command)}\n`);
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
	if (event["type"] === "offer" && boundedString(event["sdp"], MAX_SDP_BYTES)) return event as VoiceHelperEvent;
	if (event["type"] === "state" && boundedString(event["state"], 128)) return event as VoiceHelperEvent;
	if (event["type"] === "data" && "message" in event) return event as VoiceHelperEvent;
	if (event["type"] === "pcm" && boundedString(event["audio"], MAX_PCM_BYTES) && Number.isSafeInteger(event["sample_rate"]) && Number.isSafeInteger(event["num_channels"])) return event as VoiceHelperEvent;
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
