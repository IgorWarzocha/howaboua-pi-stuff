import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { NotebookMemoryUsage, RuntimeContentItem } from "../code-mode/types.ts";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface NotebookBridgeHandlers {
	callTool(cellId: string, requestId: number, tool: string, input: unknown): Promise<unknown>;
	emit(cellId: string, items: RuntimeContentItem[]): void;
	notify(cellId: string, text: string): void;
	yield(cellId: string): void;
	memory(cellId: string, usage: NotebookMemoryUsage): void;
}

export class NotebookBridgeServer {
	readonly token = randomBytes(32).toString("hex");
	private readonly handlers: NotebookBridgeHandlers;
	private server: Server | undefined;
	private origin: string | undefined;

	constructor(handlers: NotebookBridgeHandlers) {
		this.handlers = handlers;
	}

	async start(): Promise<string> {
		if (this.origin) return this.origin;
		const server = createServer((request, response) => {
			void this.handle(request, response);
		});
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Notebook bridge did not bind a TCP port");
		this.origin = `http://127.0.0.1:${address.port}`;
		return this.origin;
	}

	async shutdown(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.origin = undefined;
		if (!server) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method !== "POST" || request.url !== "/bridge") {
				writeJson(response, 404, { ok: false, error: "Not found" });
				return;
			}
			if (request.headers.authorization !== `Bearer ${this.token}`) {
				writeJson(response, 401, { ok: false, error: "Unauthorized" });
				return;
			}
			const body = await readBody(request);
			const value = JSON.parse(body) as unknown;
			if (!isRecord(value) || typeof value["kind"] !== "string" || typeof value["cellId"] !== "string") {
				throw new Error("Invalid notebook bridge request");
			}
			const cellId = value["cellId"];
			if (value["kind"] === "tool") {
				const requestId = value["requestId"];
				const tool = value["tool"];
				if (!Number.isSafeInteger(requestId) || typeof tool !== "string") throw new Error("Invalid notebook tool request");
				const result = await this.handlers.callTool(cellId, requestId as number, tool, value["input"]);
				writeJson(response, 200, { ok: true, result });
				return;
			}
			if (value["kind"] === "emit") {
				const items = parseContentItems(value["items"]);
				this.handlers.emit(cellId, items);
				writeJson(response, 200, { ok: true });
				return;
			}
			if (value["kind"] === "notify") {
				if (typeof value["text"] !== "string") throw new Error("Invalid notebook notification");
				this.handlers.notify(cellId, value["text"]);
				writeJson(response, 200, { ok: true });
				return;
			}
			if (value["kind"] === "yield") {
				this.handlers.yield(cellId);
				writeJson(response, 200, { ok: true });
				return;
			}
			if (value["kind"] === "memory") {
				this.handlers.memory(cellId, parseMemoryUsage(value["usage"]));
				writeJson(response, 200, { ok: true });
				return;
			}
			throw new Error(`Unsupported notebook bridge request: ${value["kind"]}`);
		} catch (error) {
			writeJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}
}

export function notebookBootstrapSource(origin: string, token: string): string {
	return `{
  const __origin = ${JSON.stringify(origin)};
  const __token = ${JSON.stringify(token)};
  const { getHeapStatistics: __getHeapStatistics } = await import("node:v8");
	const __parentPid = Deno.ppid;
	setInterval(() => {
	  if (Deno.ppid !== __parentPid) Deno.exit(70);
	}, 5000);
  const __state = {
    cellId: null,
    requestId: 0,
    pending: new Set(),
    store: new Map(),
    tools: undefined,
    memoryTimer: undefined,
  };
  const __decode = (_key, value) => {
    if (!value || typeof value !== "object") return value;
    if (value.__pi_type === "bigint") return BigInt(value.value);
    if (value.__pi_type === "bytes") return Uint8Array.from(atob(value.value), (char) => char.charCodeAt(0));
    return value;
  };
  const __post = async (payload) => {
    const response = await fetch(__origin + "/bridge", {
      method: "POST",
      headers: { authorization: "Bearer " + __token, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const value = text ? JSON.parse(text, __decode) : {};
    if (!response.ok || !value.ok) throw new Error(value.error || "Notebook bridge request failed");
    return value.result;
  };
  const __track = (promise) => {
    __state.pending.add(promise);
    void promise.catch(() => undefined);
    return promise;
  };
  const __stringify = (value) => {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const __emit = (items) => {
    if (!__state.cellId) throw new Error("Notebook helper called outside an active exec cell");
    __track(__post({ kind: "emit", cellId: __state.cellId, items }));
  };
  const __reportMemory = async (cellId) => {
    const usage = Deno.memoryUsage();
    await __post({
      kind: "memory",
      cellId,
      usage: {
        heapUsedBytes: usage.heapUsed,
        heapTotalBytes: usage.heapTotal,
        rssBytes: usage.rss,
        externalBytes: usage.external,
		heapLimitBytes: __getHeapStatistics().heap_size_limit,
      },
    });
  };
  const __image = (value, detail) => {
    let image_url;
	let embeddedDetail;
	if (typeof value === "string") image_url = value;
    else if (value && typeof value.image_url === "string") {
      image_url = value.image_url;
	  embeddedDetail = value.detail;
    } else if (value && value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
	  if (!value.data) throw new TypeError("image expected MCP image data");
	  image_url = value.data.toLowerCase().startsWith("data:")
		? value.data
		: "data:" + (value.mimeType || "application/octet-stream") + ";base64," + value.data;
	  const metadataDetail = value._meta?.["codex/imageDetail"];
	  embeddedDetail = ["auto", "low", "high", "original"].includes(metadataDetail) ? metadataDetail : undefined;
    } else throw new TypeError("image expects a data URL or image content item");
	if (!image_url || !/^data:/i.test(image_url)) {
	  if (/^https?:/i.test(image_url || "")) throw new TypeError("remote image URLs are not supported; pass a base64 data URI instead");
	  throw new TypeError("invalid image output; pass a base64 data URI instead");
	}
	const requestedDetail = detail !== undefined ? detail : embeddedDetail;
	let resolvedDetail = "high";
	if (requestedDetail !== undefined && requestedDetail !== null) {
	  if (typeof requestedDetail !== "string") throw new TypeError("image detail must be a string when provided");
	  resolvedDetail = requestedDetail.toLowerCase();
	  if (!["auto", "low", "high", "original"].includes(resolvedDetail)) {
		throw new TypeError("image detail must be one of: auto, low, high, original");
	  }
	}
	__emit([{ type: "input_image", image_url, detail: resolvedDetail }]);
  };
  const __tools = new Proxy({}, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      return async (input) => {
        if (!__state.cellId) throw new Error("Nested tool called outside an active exec cell");
        const requestId = ++__state.requestId;
        return await __post({ kind: "tool", cellId: __state.cellId, requestId, tool: name, input });
      };
    },
  });
  const __runtime = {
    async begin(cellId, tools) {
	  if (__state.memoryTimer !== undefined) clearInterval(__state.memoryTimer);
      __state.cellId = cellId;
      __state.pending = new Set();
      globalThis.tools = __tools;
      globalThis.ALL_TOOLS = tools;
	  await __reportMemory(cellId);
	  __state.memoryTimer = setInterval(() => void __reportMemory(cellId).catch(() => undefined), 1000);
    },
    async flush(cellId) {
      if (__state.cellId !== cellId) throw new Error("Notebook cell identity changed while executing");
      await Promise.all([...__state.pending]);
	  await __reportMemory(cellId);
    },
    end(cellId) {
	  if (__state.cellId !== cellId) return;
	  if (__state.memoryTimer !== undefined) clearInterval(__state.memoryTimer);
	  __state.memoryTimer = undefined;
	  __state.cellId = null;
    },
  };
  Object.defineProperty(globalThis, "__piNotebook", { value: __runtime, configurable: false });
	Object.defineProperty(globalThis, "repo", { value: Object.create(null), writable: false, configurable: false, enumerable: true });
  globalThis.tools = __tools;
  globalThis.ALL_TOOLS = [];
  globalThis.text = (value) => __emit([{ type: "input_text", text: __stringify(value) }]);
  globalThis.image = __image;
  globalThis.generatedImage = (value) => {
    if (!value || typeof value.image_url !== "string") throw new TypeError("generatedImage expects an image result");
	if (value.output_hint !== undefined && typeof value.output_hint !== "string") throw new TypeError("generatedImage output_hint must be a string when provided");
    __image(value.image_url);
	if (value.output_hint !== undefined) globalThis.text(value.output_hint);
  };
  globalThis.notify = (value) => {
    const text = __stringify(value);
    if (!text.trim()) throw new TypeError("notify expects non-empty text");
    if (!__state.cellId) throw new Error("notify called outside an active exec cell");
    __track(__post({ kind: "notify", cellId: __state.cellId, text }));
  };
  globalThis.yield_control = () => {
    if (!__state.cellId) throw new Error("yield_control called outside an active exec cell");
    __track(__post({ kind: "yield", cellId: __state.cellId }));
  };
  globalThis.exit = () => { throw new Error("__PI_NOTEBOOK_EXIT__"); };
  globalThis.store = (key, value) => {
    if (typeof key !== "string") throw new TypeError("store key must be a string");
    const encoded = JSON.stringify(value);
    __state.store.set(key, encoded === undefined ? undefined : JSON.parse(encoded));
  };
  globalThis.load = (key) => {
    if (typeof key !== "string") throw new TypeError("load key must be a string");
    const value = __state.store.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  };
}`;
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_REQUEST_BYTES) {
				reject(new Error(`Notebook bridge request exceeds ${MAX_REQUEST_BYTES} bytes`));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function parseContentItems(value: unknown): RuntimeContentItem[] {
	if (!Array.isArray(value)) throw new Error("Notebook output items must be an array");
	return value.map((item) => {
		if (!isRecord(item) || (item["type"] !== "input_text" && item["type"] !== "input_image")) {
			throw new Error("Invalid notebook output item");
		}
		if (item["type"] === "input_text" && typeof item["text"] === "string") {
			return { type: "input_text", text: item["text"] };
		}
		if (item["type"] === "input_image" && typeof item["image_url"] === "string") {
			const detail = item["detail"];
			return {
				type: "input_image",
				image_url: item["image_url"],
				...(detail === "auto" || detail === "low" || detail === "high" || detail === "original" || detail === null ? { detail } : {}),
			};
		}
		throw new Error("Invalid notebook output item payload");
	});
}

function parseMemoryUsage(value: unknown): NotebookMemoryUsage {
	if (!isRecord(value)) throw new Error("Invalid notebook memory usage");
	const fields = ["heapUsedBytes", "heapTotalBytes", "rssBytes", "externalBytes", "heapLimitBytes"] as const;
	for (const field of fields) {
		if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0) {
			throw new Error("Invalid notebook memory usage");
		}
	}
	return {
		heapUsedBytes: value["heapUsedBytes"] as number,
		heapTotalBytes: value["heapTotalBytes"] as number,
		rssBytes: value["rssBytes"] as number,
		externalBytes: value["externalBytes"] as number,
		heapLimitBytes: value["heapLimitBytes"] as number,
	};
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
	let body: string;
	try {
		body = JSON.stringify(value, (_key, nested) => {
			if (typeof nested === "bigint") return { __pi_type: "bigint", value: nested.toString() };
			if (nested instanceof Uint8Array) return { __pi_type: "bytes", value: Buffer.from(nested).toString("base64") };
			return nested;
		});
	} catch (error) {
		status = 500;
		body = JSON.stringify({ ok: false, error: `Notebook bridge result is not serializable: ${error instanceof Error ? error.message : String(error)}` });
	}
	if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
		status = 413;
		body = JSON.stringify({ ok: false, error: `Notebook bridge response exceeds ${MAX_RESPONSE_BYTES} bytes` });
	}
	response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
	response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
