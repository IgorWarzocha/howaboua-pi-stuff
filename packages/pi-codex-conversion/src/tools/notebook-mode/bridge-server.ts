import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CodeModeToolIdentity, NotebookMemoryUsage, RuntimeContentItem } from "../code-mode/types.ts";
import { readNotebookBridgeRequest, writeNotebookBridgeJson } from "./bridge-protocol.ts";

const BRIDGE_SHUTDOWN_GRACE_MS = 1_500;

export interface NotebookBridgeHandlers {
	callTool(cellId: string, requestId: number, toolName: CodeModeToolIdentity, input: unknown): Promise<unknown>;
	cancelTools(cellId: string): void;
	emit(cellId: string, items: RuntimeContentItem[]): void;
	notify(cellId: string, text: string): void;
	yield(cellId: string): void;
	memory(cellId: string, usage: NotebookMemoryUsage): void;
}

export class NotebookBridgeServer {
	readonly token = randomBytes(32).toString("hex");
	readonly exitToken = randomBytes(32).toString("hex");
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
		const closed = new Promise<void>((resolve) => server.close(() => resolve()));
		server.closeIdleConnections();
		if (await settlesWithin(closed, BRIDGE_SHUTDOWN_GRACE_MS)) return;
		server.closeAllConnections();
		await settlesWithin(closed, BRIDGE_SHUTDOWN_GRACE_MS);
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method !== "POST" || request.url !== "/bridge") {
				writeNotebookBridgeJson(response, 404, { ok: false, error: "Not found" });
				return;
			}
			if (request.headers.authorization !== `Bearer ${this.token}`) {
				writeNotebookBridgeJson(response, 401, { ok: false, error: "Unauthorized" });
				return;
			}
			const value = await readNotebookBridgeRequest(request);
			switch (value.kind) {
			case "tool": {
					const result = await this.handlers.callTool(value.cellId, value.requestId, value.toolName, value.input);
					writeNotebookBridgeJson(response, 200, { ok: true, result });
					return;
				}
				case "cancel_tools": this.handlers.cancelTools(value.cellId); break;
				case "emit": this.handlers.emit(value.cellId, value.items); break;
				case "notify": this.handlers.notify(value.cellId, value.text); break;
				case "yield": this.handlers.yield(value.cellId); break;
				case "memory": this.handlers.memory(value.cellId, value.usage); break;
			}
			writeNotebookBridgeJson(response, 200, { ok: true });
		} catch (error) {
			writeNotebookBridgeJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}
}


async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(() => true),
			new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
