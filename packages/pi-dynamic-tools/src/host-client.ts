import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { formatDynamicToolHelp } from "./prompt.js";
import { runDynamicTool } from "./runner.js";
import type {
	DynamicToolDefinition,
	RuntimeContentItem,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

type Pending = {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	context?: ToolExecutionContext | undefined;
	tools?: Map<string, DynamicToolDefinition> | undefined;
};

type HostClientOptions = {
	binary: string;
	tools: DynamicToolDefinition[];
};

export class CodeModeHostClient {
	private readonly binary: string;
	private readonly tools: Map<string, DynamicToolDefinition>;
	private readonly sessionId = randomUUID();
	private child: ChildProcessWithoutNullStreams | undefined;
	private buffer = Buffer.alloc(0);
	private requestId = 0;
	private ready: Promise<void> | undefined;
	private pending = new Map<number, Pending>();
	private initial = new Map<number, Pending>();
	private cellContexts = new Map<string, ToolExecutionContext>();
	private cellTools = new Map<string, Map<string, DynamicToolDefinition>>();
	private delegates = new Map<number, AbortController>();
	private notifications = new Map<string, string[]>();
	private stderr = "";

	constructor(options: HostClientOptions) {
		this.binary = options.binary;
		this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = this.startProcess();
		return this.ready;
	}

	private async startProcess(): Promise<void> {
		const child = spawn(this.binary, [], {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
		});
		this.child = child;
		child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-16_384);
		});
		child.on("error", (error) => this.failAll(error));
		child.on("close", (code) =>
			this.failAll(
				new Error(
					`Code-mode host exited with code ${code ?? "unknown"}${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`,
				),
			),
		);
		const handshake = new Promise<void>((resolve, reject) => {
			this.pending.set(0, { resolve, reject });
		});
		this.send({
			type: "connection/hello",
			supportedVersions: [1],
			requiredCapabilities: [],
			optionalCapabilities: [],
		});
		await handshake;
		await this.request({ method: "session/open", sessionId: this.sessionId });
	}

	async execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools: DynamicToolDefinition[] = [...this.tools.values()],
	): Promise<RuntimeResponse> {
		await this.start();
		const { code, yieldTimeMs, maxOutputTokens } = parseExecSource(source);
		const id = ++this.requestId;
		const initial = new Promise<any>((resolve, reject) =>
			this.initial.set(id, { resolve, reject }),
		);
		const toolSet = new Map(tools.map((tool) => [tool.name, tool]));
		const started = this.requestWithId(
			id,
			{
				method: "session/execute",
				sessionId: this.sessionId,
				request: {
					tool_call_id: `exec-${id}`,
					enabled_tools: tools.map(toWireToolDefinition),
					source: code,
					yield_time_ms: yieldTimeMs,
					max_output_tokens: maxOutputTokens,
				},
			},
			context,
			toolSet,
		);
		const abort = () => {
			this.send({ type: "operation/cancel", id });
			for (const [cellId, cellContext] of this.cellContexts) {
				if (cellContext === context)
					void this.terminate(cellId).catch(() => undefined);
			}
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			await started;
			return {
				...this.withNotifications(parseRuntimeResponse(await initial)),
				maxOutputTokens: maxOutputTokens ?? 10_000,
			};
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		await this.start();
		this.cellContexts.set(cellId, context);
		const id = ++this.requestId;
		const abort = () => this.send({ type: "operation/cancel", id });
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await this.requestWithId(
				id,
				{
					method: "session/wait",
					sessionId: this.sessionId,
					request: { cell_id: cellId, yield_time_ms: yieldTimeMs },
				},
				context,
			);
			const wrapped = value.outcome?.LiveCell ?? value.outcome?.MissingCell;
			if (!wrapped)
				throw new Error("Code-mode host returned an invalid wait outcome");
			return this.withNotifications(parseRuntimeResponse(wrapped));
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}

	async terminate(cellId: string): Promise<RuntimeResponse> {
		await this.start();
		const value = await this.request({
			method: "session/terminate",
			sessionId: this.sessionId,
			cellId,
		});
		const wrapped = value.outcome?.LiveCell ?? value.outcome?.MissingCell;
		if (!wrapped)
			throw new Error("Code-mode host returned an invalid termination outcome");
		return this.withNotifications(parseRuntimeResponse(wrapped));
	}

	async shutdown(): Promise<void> {
		const child = this.child;
		if (!child) return;
		try {
			await this.request({
				method: "session/shutdown",
				sessionId: this.sessionId,
			});
		} catch {
			// Process teardown below is authoritative.
		}
		child.kill();
		this.child = undefined;
		this.ready = undefined;
	}

	private request(
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
	): Promise<any> {
		return this.requestWithId(++this.requestId, request, context);
	}

	private requestWithId(
		id: number,
		request: Record<string, unknown>,
		context?: ToolExecutionContext,
		tools?: Map<string, DynamicToolDefinition>,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, context, tools });
			this.send({ type: "operation/request", id, request });
		});
	}

	private send(message: unknown): void {
		const child = this.child;
		if (!child?.stdin.writable)
			throw new Error("Code-mode host is not running");
		const payload = Buffer.from(JSON.stringify(message));
		if (payload.length > MAX_FRAME_BYTES)
			throw new Error(`Code-mode frame exceeds ${MAX_FRAME_BYTES} bytes`);
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32LE(payload.length);
		child.stdin.write(Buffer.concat([header, payload]));
	}

	private onData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 4) {
			const length = this.buffer.readUInt32LE(0);
			if (length > MAX_FRAME_BYTES)
				return this.failAll(
					new Error(`Code-mode frame exceeds ${MAX_FRAME_BYTES} bytes`),
				);
			if (this.buffer.length < length + 4) return;
			const payload = this.buffer.subarray(4, length + 4);
			this.buffer = this.buffer.subarray(length + 4);
			try {
				this.handleMessage(JSON.parse(payload.toString("utf8")));
			} catch (error) {
				this.failAll(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	private handleMessage(message: any): void {
		if (message.type === "connection/ready") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.resolve(undefined);
			return;
		}
		if (message.type === "connection/rejected") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.reject(
				new Error(
					`Code-mode handshake rejected: ${JSON.stringify(message.reason)}`,
				),
			);
			return;
		}
		if (message.type === "operation/response") {
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (!pending) return;
			if (message.result?.status === "error")
				return pending.reject(new Error(message.result.message));
			const value = message.result?.value;
			if (value?.type === "execution/started" && pending.context) {
				this.cellContexts.set(value.cellId, pending.context);
				if (pending.tools) this.cellTools.set(value.cellId, pending.tools);
			}
			pending.resolve(value);
			return;
		}
		if (message.type === "execute/initialResponse") {
			const pending = this.initial.get(message.id);
			this.initial.delete(message.id);
			if (!pending) return;
			if (message.result?.status === "error")
				pending.reject(new Error(message.result.message));
			else pending.resolve(message.result?.value);
			return;
		}
		if (message.type === "delegate/request") {
			void this.handleDelegate(message);
			return;
		}
		if (message.type === "delegate/cancel") {
			this.delegates.get(message.id)?.abort();
			return;
		}
		if (message.type === "cell/closed") {
			this.cellContexts.delete(message.cellId);
			this.cellTools.delete(message.cellId);
		}
	}

	private async handleDelegate(message: any): Promise<void> {
		const request = message.request;
		if (request?.type === "notification/send") {
			const context = this.cellContexts.get(request.cellId);
			const notifications = this.notifications.get(request.cellId) ?? [];
			notifications.push(request.text);
			this.notifications.set(request.cellId, notifications);
			context?.onUpdate?.({
				content: [{ type: "text", text: request.text }],
				details: { cellId: request.cellId, notification: true },
			});
			this.send({
				type: "delegate/response",
				id: message.id,
				result: { status: "ok", value: { type: "notification/delivered" } },
			});
			return;
		}
		if (request?.type !== "tool/invoke") {
			this.send({
				type: "delegate/response",
				id: message.id,
				result: {
					status: "error",
					message: "Unsupported code-mode delegate request",
				},
			});
			return;
		}
		const invocation = request.invocation;
		const tool = this.cellTools
			.get(invocation?.cell_id)
			?.get(invocation?.tool_name?.name);
		const context = this.cellContexts.get(invocation?.cell_id);
		if (!tool || !context) {
			this.send({
				type: "delegate/response",
				id: message.id,
				result: {
					status: "error",
					message: !tool
						? `Unknown dynamic tool: ${invocation?.tool_name?.name}`
						: "Code-mode cell context is unavailable",
				},
			});
			return;
		}
		const controller = new AbortController();
		this.delegates.set(message.id, controller);
		try {
			const result = await runDynamicTool(
				tool,
				invocation.input,
				context.cwd,
				controller.signal,
			);
			this.send({
				type: "delegate/response",
				id: message.id,
				result: { status: "ok", value: { type: "tool/result", result } },
			});
		} catch (error) {
			this.send({
				type: "delegate/response",
				id: message.id,
				result: {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				},
			});
		} finally {
			this.delegates.delete(message.id);
		}
	}

	private failAll(error: Error): void {
		for (const pending of [...this.pending.values(), ...this.initial.values()])
			pending.reject(error);
		this.pending.clear();
		this.initial.clear();
		for (const controller of this.delegates.values()) controller.abort();
		this.delegates.clear();
	}

	private withNotifications(response: RuntimeResponse): RuntimeResponse {
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		if (notifications.length === 0) return response;
		return {
			...response,
			contentItems: [
				...notifications.map((text) => ({ type: "input_text" as const, text })),
				...response.contentItems,
			],
		};
	}
}

function toWireToolDefinition(tool: DynamicToolDefinition) {
	return {
		name: tool.name,
		tool_name: { name: tool.name, namespace: null },
		description: formatDynamicToolHelp(tool),
		kind: "freeform",
		input_schema: null,
		output_schema: null,
	};
}

function parseExecSource(source: string): {
	code: string;
	yieldTimeMs: number | null;
	maxOutputTokens: number | null;
} {
	if (!source.trim())
		throw new Error("exec requires non-empty JavaScript source");
	const [first, ...rest] = source.split("\n");
	const trimmed = first?.trimStart() ?? "";
	if (!trimmed.startsWith("// @exec:"))
		return { code: source, yieldTimeMs: null, maxOutputTokens: null };
	if (rest.join("\n").trim() === "")
		throw new Error("exec pragma must be followed by JavaScript source");
	const options = JSON.parse(
		trimmed.slice("// @exec:".length).trim(),
	) as Record<string, unknown>;
	for (const key of Object.keys(options))
		if (key !== "yield_time_ms" && key !== "max_output_tokens")
			throw new Error(`Unsupported exec pragma field: ${key}`);
	const integer = (value: unknown, name: string): number | null => {
		if (value === undefined) return null;
		if (!Number.isSafeInteger(value) || Number(value) < 0)
			throw new Error(`${name} must be a non-negative safe integer`);
		return Number(value);
	};
	return {
		code: rest.join("\n"),
		yieldTimeMs: integer(options["yield_time_ms"], "yield_time_ms"),
		maxOutputTokens: integer(options["max_output_tokens"], "max_output_tokens"),
	};
}

function parseRuntimeResponse(value: any): RuntimeResponse {
	const kind = value?.Yielded
		? "yielded"
		: value?.Terminated
			? "terminated"
			: value?.Result
				? "result"
				: undefined;
	if (!kind)
		throw new Error("Code-mode host returned an invalid runtime response");
	const body =
		value[
			kind === "yielded"
				? "Yielded"
				: kind === "terminated"
					? "Terminated"
					: "Result"
		];
	return {
		kind,
		cellId: body.cell_id,
		contentItems: (body.content_items ?? []) as RuntimeContentItem[],
		...(kind === "result" && body.error_text
			? { errorText: body.error_text }
			: {}),
	};
}
