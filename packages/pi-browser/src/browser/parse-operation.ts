import type { SnapshotResponseLength } from "../cdp/snapshot-contract.js";
import {
	BROWSER_ACTIONS,
	type BrowserAction,
	type BrowserOperation,
} from "./operation.js";

export type ActionRequest = BrowserOperation | { action: "help" };

const fields = (...names: string[]) => new Set(["action", ...names]);

const ACTION_FIELDS: Record<BrowserAction, ReadonlySet<string>> = {
	help: fields(),
	start: fields(),
	tabs: fields("query", "offset"),
	open: fields("ref_id", "url", "lineno", "response_length"),
	find: fields("ref_id", "pattern", "lineno", "response_length"),
	click: fields("ref_id", "id", "selector", "x", "y"),
	type: fields("ref_id", "id", "text"),
	screenshot: fields("ref_id", "id", "selector"),
	html: fields("ref_id", "id", "selector"),
	navigate: fields("ref_id", "url"),
	evaluate: fields("ref_id", "expression"),
	network: fields("ref_id"),
	load_all: fields("ref_id", "selector", "interval_ms"),
	raw: fields("ref_id", "method", "params"),
	read_result: fields("handle", "offset"),
	discard_result: fields("handle"),
	stop: fields("ref_id"),
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, field);
}

function requiredRef(value: unknown, action: BrowserAction): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(
			`${action} requires a ref_id returned by tabs; call tabs first`,
		);
	}
	return value.trim();
}

function offset(value: unknown, field = "offset", fallback = 0): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || Number(value) < 0) {
		throw new Error(`${field} must be a non-negative integer`);
	}
	return Number(value);
}

function line(value: unknown): number {
	const parsed = offset(value, "lineno", 1);
	if (parsed < 1) throw new Error("lineno must be at least 1");
	return parsed;
}

function elementId(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new Error("id must be a positive integer from open/find");
	}
	return Number(value);
}

function responseLength(value: unknown): SnapshotResponseLength {
	if (value === undefined) return "medium";
	if (value !== "short" && value !== "medium" && value !== "long") {
		throw new Error("response_length must be one of: short, medium, long");
	}
	return value;
}

function resultHandle(value: unknown): string {
	const handle = requiredString(value, "handle");
	if (!/^[a-f0-9-]{36}$/.test(handle)) {
		throw new Error("handle is invalid");
	}
	return handle;
}

function browserAction(value: unknown): BrowserAction {
	if (
		typeof value !== "string" ||
		!BROWSER_ACTIONS.includes(value as BrowserAction)
	) {
		throw new Error(`action must be one of: ${BROWSER_ACTIONS.join(", ")}`);
	}
	return value as BrowserAction;
}

export function parseActionRequest(value: unknown): ActionRequest {
	if (!isRecord(value)) throw new Error("input must be a JSON object");
	const action = browserAction(value["action"]);
	const unknown = Object.keys(value).filter(
		(key) => !ACTION_FIELDS[action].has(key),
	);
	if (unknown.length > 0) {
		throw new Error(`unknown ${action} field(s): ${unknown.join(", ")}`);
	}
	if (action === "help" || action === "start") return { action };
	if (action === "tabs") {
		const query = optionalString(value["query"], "query");
		return {
			action,
			...(query ? { query } : {}),
			offset: offset(value["offset"]),
		};
	}
	if (action === "open") {
		const refId = optionalString(value["ref_id"], "ref_id");
		const url = optionalString(value["url"], "url");
		if (Boolean(refId) === Boolean(url)) {
			throw new Error("open requires exactly one of ref_id or url");
		}
		if (url) return { action, url };
		if (!refId) throw new Error("open requires ref_id or url");
		return {
			action,
			ref_id: refId,
			lineno: line(value["lineno"]),
			response_length: responseLength(value["response_length"]),
		};
	}
	if (action === "find") {
		return {
			action,
			ref_id: requiredRef(value["ref_id"], action),
			pattern: requiredString(value["pattern"], "pattern"),
			lineno: line(value["lineno"]),
			response_length: responseLength(value["response_length"]),
		};
	}
	if (action === "read_result") {
		return {
			action,
			handle: resultHandle(value["handle"]),
			offset: offset(value["offset"]),
		};
	}
	if (action === "discard_result") {
		return { action, handle: resultHandle(value["handle"]) };
	}
	if (action === "stop") {
		const refId = optionalString(value["ref_id"], "ref_id");
		return { action, ...(refId ? { ref_id: refId } : {}) };
	}

	const refId = requiredRef(value["ref_id"], action);
	if (action === "network") return { action, ref_id: refId };
	if (action === "navigate") {
		return {
			action,
			ref_id: refId,
			url: requiredString(value["url"], "url"),
		};
	}
	if (action === "evaluate") {
		return {
			action,
			ref_id: refId,
			expression: requiredString(value["expression"], "expression"),
		};
	}
	if (action === "click") {
		const id = elementId(value["id"]);
		const selector = optionalString(value["selector"], "selector");
		const hasX = value["x"] !== undefined;
		const hasY = value["y"] !== undefined;
		let coordinates: { x: number; y: number } | undefined;
		if (hasX !== hasY) {
			throw new Error("click coordinates require both x and y");
		}
		if (
			hasX &&
			(typeof value["x"] !== "number" ||
				!Number.isFinite(value["x"]) ||
				typeof value["y"] !== "number" ||
				!Number.isFinite(value["y"]))
		) {
			throw new Error("x and y must be finite CSS-pixel numbers");
		}
		if (typeof value["x"] === "number" && typeof value["y"] === "number") {
			coordinates = { x: value["x"], y: value["y"] };
		}
		if (
			Number(id !== undefined) + Number(Boolean(selector)) + Number(hasX) !==
			1
		) {
			throw new Error("click requires exactly one of id, selector, or x+y");
		}
		if (id !== undefined) return { action, ref_id: refId, id };
		if (selector) return { action, ref_id: refId, selector };
		if (coordinates) {
			return { action, ref_id: refId, ...coordinates };
		}
		throw new Error("click requires id, selector, or x+y");
	}
	if (action === "type") {
		if (typeof value["text"] !== "string" || value["text"].length === 0) {
			throw new Error("text must be a non-empty string");
		}
		const id = elementId(value["id"]);
		return {
			action,
			ref_id: refId,
			...(id === undefined ? {} : { id }),
			text: value["text"],
		};
	}
	if (action === "screenshot" || action === "html") {
		const id = elementId(value["id"]);
		const selector = optionalString(value["selector"], "selector");
		if (id !== undefined && selector) {
			throw new Error(`${action} accepts id or selector, not both`);
		}
		return {
			action,
			ref_id: refId,
			...(id === undefined ? {} : { id }),
			...(selector ? { selector } : {}),
		};
	}
	if (action === "load_all") {
		const interval = value["interval_ms"] ?? 1_500;
		if (
			!Number.isInteger(interval) ||
			Number(interval) < 0 ||
			Number(interval) > 60_000
		) {
			throw new Error("interval_ms must be an integer from 0 to 60000");
		}
		return {
			action,
			ref_id: refId,
			selector: requiredString(value["selector"], "selector"),
			interval_ms: Number(interval),
		};
	}
	if (action === "raw") {
		const params = value["params"] ?? {};
		if (!isRecord(params)) {
			throw new Error("params must be an object when provided");
		}
		return {
			action,
			ref_id: refId,
			method: requiredString(value["method"], "method"),
			params,
		};
	}
	throw new Error(`unsupported action: ${action}`);
}

export function isRecordValue(
	value: unknown,
): value is Record<string, unknown> {
	return isRecord(value);
}
