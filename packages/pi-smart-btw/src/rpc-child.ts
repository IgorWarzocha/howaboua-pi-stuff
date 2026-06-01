import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { modelRef, readConfig } from "./config.js";
import {
	POLL_MS,
	QUIET_MS,
	READY_TIMEOUT,
	RESPONSE_TIMEOUT,
} from "./constants.js";
import type { ChildDetails } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function getFinalOutput(messages: any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		for (const part of message.content ?? [])
			if (part.type === "text") return part.text;
	}
	return "";
}

export class BtwChild {
	readonly details: ChildDetails;
	private proc: ChildProcessWithoutNullStreams;
	private requestId = 0;
	private stdoutBuffer = "";
	private pending = new Map<
		string,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();
	private lastEventAt = Date.now();
	private agentEndCount = 0;
	private lastAgentMessages: any[] = [];
	private currentPartial = "";
	private onPartial: ((text: string) => void) | undefined;
	private closed = false;
	private exitCode: number | undefined;
	private readonly onUpdate: (() => void) | undefined;

	constructor(cwd: string, onUpdate?: () => void) {
		this.onUpdate = onUpdate;
		const cfg = readConfig();
		const args = ["--mode", "rpc", "--no-session"];
		args.push("--model", modelRef(cfg.provider, cfg.modelId));
		if (cfg.thinking) args.push("--thinking", cfg.thinking);
		this.details = {
			cwd,
			provider: cfg.provider,
			modelId: cfg.modelId,
			thinking: cfg.thinking,
			messages: [],
			stderr: "",
			usage: {
				turns: 0,
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
			},
		};
		this.proc = spawn(cfg.command, args, {
			cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PI_SMART_BTW_CHILD: "1" },
		});
		this.proc.stdout.on("data", (chunk) => this.onStdout(chunk.toString()));
		this.proc.stderr.on("data", (chunk) => {
			this.details.stderr += chunk.toString();
			this.onUpdate?.();
		});
		this.proc.on("close", (code) => {
			this.closed = true;
			this.exitCode = code ?? 0;
			this.rejectAll(new Error(`btw child exited with code ${this.exitCode}`));
		});
		this.proc.on("error", (error) =>
			this.rejectAll(error instanceof Error ? error : new Error(String(error))),
		);
	}

	async ready() {
		await this.send({ type: "get_state" }, READY_TIMEOUT);
		await this.send({ type: "set_auto_compaction", enabled: true });
		await this.send({ type: "set_auto_retry", enabled: true });
	}

	async ask(
		question: string,
		onPartial?: (text: string) => void,
		promptMessage?: string,
	) {
		const before = this.agentEndCount;
		const beforeMessages = this.details.messages.length;
		this.lastAgentMessages = [];
		this.currentPartial = "";
		this.onPartial = onPartial;
		await this.send({
			type: "prompt",
			message:
				promptMessage ??
				[
					"Answer the user's question directly.",
					"Use available tools only if they are needed to answer accurately.",
					"Be concise unless the question requires detail.",
					`Question: ${question}`,
				].join("\n\n"),
			streamingBehavior: "followUp",
		});
		await this.waitForAnswer(before);
		this.onPartial = undefined;
		return (
			getFinalOutput(this.lastAgentMessages) ||
			getFinalOutput(this.details.messages.slice(beforeMessages)) ||
			this.currentPartial
		).trim();
	}

	async stop() {
		if (this.closed) return;
		this.proc.kill("SIGTERM");
		await Promise.race([
			new Promise<void>((resolve) => this.proc.once("close", () => resolve())),
			sleep(1000).then(() => {
				if (!this.closed) this.proc.kill("SIGKILL");
			}),
		]);
	}

	private async waitForAnswer(beforeCount: number) {
		while (!this.closed) {
			await sleep(POLL_MS);
			const quiet = Date.now() - this.lastEventAt >= QUIET_MS;
			if (this.agentEndCount > beforeCount && quiet) return;
		}
		throw new Error(
			`btw child closed.${this.details.stderr ? ` Stderr: ${this.details.stderr.trim()}` : ""}`,
		);
	}

	private send<T = unknown>(
		command: Record<string, unknown>,
		timeoutMs = RESPONSE_TIMEOUT,
	): Promise<T> {
		if (this.closed || !this.proc.stdin.writable)
			throw new Error("btw child RPC is not available");
		const id = `req_${++this.requestId}`;
		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for ${String(command["type"])}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => resolve(v as T),
				reject,
				timeout,
			});
			this.proc.stdin.write(
				JSON.stringify({ ...command, id }) + "\n",
				(err) => {
					if (!err) return;
					clearTimeout(timeout);
					this.pending.delete(id);
					reject(err instanceof Error ? err : new Error(String(err)));
				},
			);
		});
	}

	private onStdout(chunk: string) {
		this.stdoutBuffer += chunk;
		const lines = this.stdoutBuffer.split("\n");
		this.stdoutBuffer = lines.pop() ?? "";
		for (const line of lines) this.handleLine(line);
	}

	private handleLine(line: string) {
		if (!line.trim()) return;
		let data: any;
		try {
			data = JSON.parse(line);
		} catch {
			return;
		}
		if (this.handleResponse(data)) return;
		this.lastEventAt = Date.now();
		if (data.type === "agent_end") this.handleAgentEnd(data);
		if (data.type === "message_end" && data.message)
			this.handleMessageEnd(data.message);
		if (data.type === "message_update") this.handleMessageUpdate(data);
	}

	private handleResponse(data: any) {
		if (
			!(
				data.type === "response" &&
				typeof data.id === "string" &&
				this.pending.has(data.id)
			)
		)
			return false;
		const pending = this.pending.get(data.id)!;
		clearTimeout(pending.timeout);
		this.pending.delete(data.id);
		data.success === false
			? pending.reject(
					new Error(String(data.error ?? `RPC ${data.command} failed`)),
				)
			: pending.resolve(data.data);
		return true;
	}

	private handleAgentEnd(data: any) {
		this.agentEndCount++;
		this.lastAgentMessages = Array.isArray(data.messages) ? data.messages : [];
	}

	private handleMessageUpdate(event: any) {
		const partial = event.assistantMessageEvent?.partial;
		if (partial?.role !== "assistant") return;
		const text = getFinalOutput([partial]).trim();
		if (!text || text === this.currentPartial) return;
		this.currentPartial = text;
		this.onPartial?.(text);
		this.onUpdate?.();
	}

	private handleMessageEnd(message: any) {
		this.details.messages.push(message);
		if (message.role === "assistant") {
			this.details.usage.turns++;
			const u = message.usage;
			if (u) {
				this.details.usage.input += u.input || 0;
				this.details.usage.output += u.output || 0;
				this.details.usage.cacheRead += u.cacheRead || 0;
				this.details.usage.cacheWrite += u.cacheWrite || 0;
				this.details.usage.cost += u.cost?.total || 0;
				this.details.usage.contextTokens = u.totalTokens || 0;
			}
			if (message.stopReason) this.details.stopReason = message.stopReason;
			if (message.errorMessage)
				this.details.errorMessage = message.errorMessage;
		}
		this.onUpdate?.();
	}

	private rejectAll(error: Error) {
		for (const p of this.pending.values()) {
			clearTimeout(p.timeout);
			p.reject(error);
		}
		this.pending.clear();
	}
}
