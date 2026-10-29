export type CoreObject = Record<string, unknown>;

export interface CoreSnapshot {
	seq: number;
	terminals: CoreObject[];
}

interface CoreEvent {
	seq: number;
	type: string;
	data: unknown;
	terminal?: string;
	machine?: string;
}

export type CoreNotification =
	| ({ method: "snapshot" | "missed" } & CoreSnapshot)
	| { method: "event"; event: CoreEvent }
	| { method: "heartbeat"; seq: number };

class CoreRpcError extends Error {
	readonly code: number;
	readonly kind: string;
	readonly hint: string;

	constructor(code: number, message: string, kind: string, hint: string) {
		super(message);
		this.name = "CoreRpcError";
		this.code = code;
		this.kind = kind;
		this.hint = hint;
	}
}

export function object(value: unknown): CoreObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid Core JSON-RPC object");
	}
	return value as CoreObject;
}

function sequence(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("Invalid Core event sequence");
	}
	return value;
}

export function response(message: CoreObject): unknown {
	if (message["jsonrpc"] !== "2.0" || message["id"] !== 1) {
		throw new Error("Invalid Core JSON-RPC response");
	}
	if ("error" in message === "result" in message) {
		throw new Error("Invalid Core JSON-RPC result");
	}
	if ("error" in message) {
		const error = object(message["error"]);
		const data = object(error["data"]);
		if (
			typeof error["code"] !== "number" ||
			!Number.isSafeInteger(error["code"]) ||
			typeof error["message"] !== "string" ||
			typeof data["kind"] !== "string" ||
			typeof data["hint"] !== "string"
		) {
			throw new Error("Invalid Core JSON-RPC error");
		}
		throw new CoreRpcError(
			error["code"],
			error["message"],
			data["kind"],
			data["hint"],
		);
	}
	return message["result"];
}

export function snapshot(value: unknown): CoreSnapshot {
	const data = object(value);
	const terminals = data["terminals"];
	if (!Array.isArray(terminals)) throw new Error("Invalid Core snapshot");
	return { seq: sequence(data["seq"]), terminals: terminals.map(object) };
}

export function notification(message: CoreObject): CoreNotification {
	if (message["jsonrpc"] !== "2.0" || "id" in message) {
		throw new Error("Invalid Core notification");
	}
	const params = object(message["params"]);
	switch (message["method"]) {
		case "missed":
			return { method: "missed", ...snapshot(params) };
		case "heartbeat":
			return { method: "heartbeat", seq: sequence(params["seq"]) };
		case "event": {
			if (typeof params["type"] !== "string" || !("data" in params)) {
				throw new Error("Invalid Core event");
			}
			const event: CoreEvent = {
				seq: sequence(params["seq"]),
				type: params["type"],
				data: params["data"],
			};
			for (const key of ["terminal", "machine"] as const) {
				if (key in params) {
					if (typeof params[key] !== "string")
						throw new Error("Invalid Core event address");
					event[key] = params[key];
				}
			}
			return { method: "event", event };
		}
		default:
			throw new Error("Unknown Core notification");
	}
}
