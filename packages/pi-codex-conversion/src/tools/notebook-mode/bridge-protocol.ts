import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodeModeToolIdentity, NotebookMemoryUsage, RuntimeContentItem } from "../code-mode/types.ts";

const MAX_REQUEST_BYTES = 34 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type NotebookBridgeRequest =
	| { kind: "tool"; cellId: string; requestId: number; toolName: CodeModeToolIdentity; input: unknown }
	| { kind: "cancel_tools"; cellId: string }
	| { kind: "emit"; cellId: string; items: RuntimeContentItem[] }
	| { kind: "notify"; cellId: string; text: string }
	| { kind: "yield"; cellId: string }
	| { kind: "memory"; cellId: string; usage: NotebookMemoryUsage };

export async function readNotebookBridgeRequest(request: IncomingMessage): Promise<NotebookBridgeRequest> {
	const value = JSON.parse(await readBody(request)) as unknown;
	if (!isRecord(value) || typeof value["kind"] !== "string" || typeof value["cellId"] !== "string") {
		throw new Error("Invalid notebook bridge request");
	}
	const cellId = value["cellId"];
	switch (value["kind"]) {
		case "tool": {
			const requestId = value["requestId"];
			const toolName = value["toolName"];
			const namespace = isRecord(toolName) ? toolName["namespace"] : undefined;
			if (
				!Number.isSafeInteger(requestId)
				|| !isRecord(toolName)
				|| typeof toolName["name"] !== "string"
				|| (namespace !== undefined && typeof namespace !== "string")
			) throw new Error("Invalid notebook tool request");
			return {
				kind: "tool",
				cellId,
				requestId: requestId as number,
				toolName: {
					name: toolName["name"],
					...(typeof namespace === "string" ? { namespace } : {}),
				},
				input: value["input"],
			};
		}
		case "cancel_tools": return { kind: "cancel_tools", cellId };
		case "emit": return { kind: "emit", cellId, items: parseContentItems(value["items"]) };
		case "notify":
			if (typeof value["text"] !== "string") throw new Error("Invalid notebook notification");
			return { kind: "notify", cellId, text: value["text"] };
		case "yield": return { kind: "yield", cellId };
		case "memory": return { kind: "memory", cellId, usage: parseMemoryUsage(value["usage"]) };
		default: throw new Error(`Unsupported notebook bridge request: ${value["kind"]}`);
	}
}

export function writeNotebookBridgeJson(response: ServerResponse, status: number, value: unknown): void {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
