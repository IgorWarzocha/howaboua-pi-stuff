import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { HerdrConnection } from "./herdr-client.js";
import type { RemoteMachineConfig } from "./machines-config.js";
import type { AssistantReader } from "./session-reader.js";
import type { HerdrEvent, LatestAssistant } from "./types.js";

const PROTOCOL = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DEPLOY_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 15_000;

const DEPLOY_SOURCE = String.raw`
const { createHash, randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, unlink, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");
const targetValue = process.argv[1];
const expected = process.argv[2];
const marker = "// @howaboua/pi-shepherdr managed bridge";
const target = targetValue === "~" ? homedir() : targetValue.startsWith("~/") ? join(homedir(), targetValue.slice(2)) : targetValue;
const chunks = [];
let size = 0;
process.stdin.on("data", chunk => { size += chunk.length; if (size > 1024 * 1024) { process.stderr.write("bridge source is too large\n"); process.exit(1); } chunks.push(chunk); });
process.stdin.on("end", () => { void (async () => {
  const source = Buffer.concat(chunks);
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expected) throw new Error("bridge upload hash mismatch");
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) {
    const current = createHash("sha256").update(existing).digest("hex");
    if (current === expected) { process.stdout.write(JSON.stringify({ updated: false, path: target }) + "\n"); return; }
    if (!existing.toString("utf8", 0, marker.length + 32).startsWith(marker)) throw new Error(target + " is not owned by Shepherdr");
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  process.stdout.write(JSON.stringify({ updated: true, path: target }) + "\n");
})().catch(error => { process.stderr.write(error.message + "\n"); process.exit(1); }); });
`;

interface PendingCall {
	reject: (error: Error) => void;
	resolve: (value: unknown) => void;
	timer: NodeJS.Timeout;
}

interface SubscriptionCallbacks {
	onDisconnect: (error?: Error) => void;
	onEvent: (event: HerdrEvent) => void;
}

interface BridgeError {
	code?: string;
	herdrResponse?: boolean;
	message: string;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function executablePath(path: string): string {
	return path.startsWith("~/")
		? `"$HOME"/${shellQuote(path.slice(2))}`
		: shellQuote(path);
}

function remoteCommand(config: RemoteMachineConfig, hash: string): string {
	const path = `${config.agentDir.replace(/\/$/, "")}/shepherdr.mjs`;
	const args = [
		"exec",
		shellQuote(config.node),
		executablePath(path),
		"--hash",
		shellQuote(hash),
		...(config.socket ? ["--socket", shellQuote(config.socket)] : []),
		...(config.session ? ["--session", shellQuote(config.session)] : []),
	];
	return args.join(" ");
}

function spawnConnector(
	config: RemoteMachineConfig,
	command: string,
): ChildProcessWithoutNullStreams {
	const [program, ...args] = config.command;
	if (!program) throw new Error("remote machine command is empty");
	return spawn(program, [...args, command], {
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function appendBounded(current: string, chunk: Buffer): string {
	const next = current + chunk.toString("utf8");
	return next.length <= MAX_DIAGNOSTIC_BYTES
		? next
		: next.slice(next.length - MAX_DIAGNOSTIC_BYTES);
}

async function deploy(
	config: RemoteMachineConfig,
	source: Buffer,
	hash: string,
): Promise<void> {
	const target = `${config.agentDir.replace(/\/$/, "")}/shepherdr.mjs`;
	const command = [
		shellQuote(config.node),
		"-e",
		shellQuote(DEPLOY_SOURCE),
		shellQuote(target),
		shellQuote(hash),
	].join(" ");
	const child = spawnConnector(config, command);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = appendBounded(stdout, chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = appendBounded(stderr, chunk);
	});
	child.stdin.end(source);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("remote bridge deployment timed out"));
		}, DEPLOY_TIMEOUT_MS);
		timer.unref();
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else
				reject(
					new Error(
						stderr.trim() ||
							stdout.trim() ||
							`remote bridge deployment exited ${code ?? "without status"}`,
					),
				);
		});
	});
}

export class RemoteHerdrClient implements HerdrConnection, AssistantReader {
	private readonly child: ChildProcessWithoutNullStreams;
	private closed = false;
	private diagnostics = "";
	private input = "";
	private readonly onClose: (error: Error) => void;
	private readonly pending = new Map<string, PendingCall>();
	private readonly subscriptions = new Map<string, SubscriptionCallbacks>();

	private constructor(
		child: ChildProcessWithoutNullStreams,
		onClose: (error: Error) => void,
	) {
		this.child = child;
		this.onClose = onClose;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.consume(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			this.diagnostics = appendBounded(this.diagnostics, chunk);
		});
		child.on("error", (error) => this.disconnected(error));
		child.on("exit", (code) => {
			this.disconnected(
				new Error(
					this.diagnostics.trim() ||
						`remote Shepherdr bridge exited ${code ?? "without status"}`,
				),
			);
		});
	}

	static async connect(
		config: RemoteMachineConfig,
		onClose: (error: Error) => void,
	): Promise<RemoteHerdrClient> {
		const source = await readFile(
			fileURLToPath(new URL("./remote/shepherdr.mjs", import.meta.url)),
		);
		const hash = createHash("sha256").update(source).digest("hex");
		await deploy(config, source, hash);
		const child = spawnConnector(config, remoteCommand(config, hash));
		const client = new RemoteHerdrClient(child, onClose);
		try {
			await client.ready(hash);
			return client;
		} catch (error) {
			client.close();
			throw error;
		}
	}

	async request<T>(
		method: string,
		params: object = {},
		timeoutMs = 10_000,
	): Promise<T> {
		return (await this.call(
			{ op: "request", method, params, timeoutMs },
			timeoutMs + 1_000,
		)) as T;
	}

	async subscribe(
		subscriptions: object[],
		onEvent: (event: HerdrEvent) => void,
		onDisconnect: (error?: Error) => void,
	): Promise<() => void> {
		const id = randomUUID();
		this.subscriptions.set(id, { onEvent, onDisconnect });
		try {
			await this.call({ id, op: "subscribe", subscriptions }, 11_000);
		} catch (error) {
			this.subscriptions.delete(id);
			throw error;
		}
		return () => {
			if (!this.subscriptions.delete(id) || this.closed) return;
			void this.call({ op: "unsubscribe", subscription: id }).catch(
				() => undefined,
			);
		};
	}

	async latest(path?: string): Promise<LatestAssistant | undefined> {
		return (await this.call({ op: "latest", path })) as
			| LatestAssistant
			| undefined;
	}

	async directory(
		value: string | undefined,
		fallback: string,
	): Promise<string> {
		return (await this.call({ op: "directory", value, fallback })) as string;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.child.kill();
		this.failPending(new Error("remote Shepherdr bridge closed"), false);
	}

	private ready(expectedHash: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.close();
				reject(new Error("remote Shepherdr bridge did not become ready"));
			}, READY_TIMEOUT_MS);
			timer.unref();
			this.pending.set("ready", {
				timer,
				resolve: (value) => {
					const ready = value as { hash?: unknown; protocol?: unknown };
					if (ready.protocol !== PROTOCOL || ready.hash !== expectedHash) {
						reject(new Error("remote Shepherdr bridge version mismatch"));
						return;
					}
					resolve();
				},
				reject,
			});
		});
	}

	private call(
		message: Record<string, unknown>,
		timeoutMs = 10_000,
	): Promise<unknown> {
		if (this.closed)
			return Promise.reject(
				new Error("remote Shepherdr bridge is unavailable"),
			);
		const id = typeof message["id"] === "string" ? message["id"] : randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(`remote Shepherdr ${String(message["op"])} timed out`),
				);
			}, timeoutMs);
			timer.unref();
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(
				`${JSON.stringify({ ...message, id })}\n`,
				(error) => {
					if (!error) return;
					const pending = this.pending.get(id);
					if (!pending) return;
					this.pending.delete(id);
					clearTimeout(pending.timer);
					pending.reject(error);
				},
			);
		});
	}

	private consume(chunk: string): void {
		this.input += chunk;
		if (Buffer.byteLength(this.input) > MAX_FRAME_BYTES) {
			this.disconnected(
				new Error("remote Shepherdr bridge frame is too large"),
			);
			return;
		}
		for (;;) {
			const newline = this.input.indexOf("\n");
			if (newline < 0) break;
			const line = this.input.slice(0, newline);
			this.input = this.input.slice(newline + 1);
			if (!line) continue;
			let value: Record<string, unknown>;
			try {
				value = JSON.parse(line) as Record<string, unknown>;
			} catch (error) {
				this.disconnected(
					new Error(
						`remote Shepherdr bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
				return;
			}
			if (value["type"] === "ready") {
				this.resolvePending("ready", value);
				continue;
			}
			const subscription = value["subscription"];
			if (typeof subscription === "string") {
				const callbacks = this.subscriptions.get(subscription);
				const event = value["event"];
				if (callbacks && event && typeof event === "object")
					callbacks.onEvent(event as HerdrEvent);
				continue;
			}
			const id = value["id"];
			if (typeof id !== "string") continue;
			if (value["ok"] === true) this.resolvePending(id, value["result"]);
			else {
				const detail = value["error"] as BridgeError | undefined;
				const error = new Error(
					detail?.message ?? "remote Shepherdr bridge request failed",
				) as Error & {
					code?: string;
					herdrResponse?: true;
				};
				if (detail?.code) error.code = detail.code;
				if (detail?.herdrResponse) error.herdrResponse = true;
				this.rejectPending(id, error);
			}
		}
	}

	private resolvePending(id: string, value: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.resolve(value);
	}

	private rejectPending(id: string, error: Error): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.reject(error);
	}

	private disconnected(error: Error): void {
		if (this.closed) return;
		this.closed = true;
		this.child.kill();
		this.failPending(error, true);
	}

	private failPending(error: Error, notify: boolean): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		for (const callbacks of this.subscriptions.values())
			callbacks.onDisconnect(error);
		this.subscriptions.clear();
		if (notify) this.onClose(error);
	}
}
