import { createHash } from "node:crypto";
import type { Outcome } from "./contracts.ts";

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: {};
}

export function string(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

export function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function timestamp(value: unknown): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function textContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((item) => {
			const part = object(item);
			if (part["type"] === "text") return string(part["text"]);
			if (part["type"] === "toolCall")
				return `[tool call: ${string(part["name"])}]`;
			return `[${string(part["type"], "non-text content")}]`;
		})
		.join("\n");
}

export function displayValue(value: unknown): string {
	const text = JSON.stringify(
		value ?? null,
		(_key, item: unknown) => {
			const part = object(item);
			if (
				["image", "input_image", "audio", "input_audio"].includes(
					string(part["type"]),
				)
			) {
				return {
					type: part["type"],
					note: "Binary content omitted from index",
				};
			}
			if (typeof item === "string" && item.length > 131_072)
				return `${item.slice(0, 131_072)}\n[Index text truncated]`;
			return item;
		},
		2,
	);
	return text.length > 524_288
		? `${text.slice(0, 524_288)}\n[Index detail truncated]`
		: text;
}

function signature(text: string): string {
	return (text.split("\n").find((line) => line.trim()) ?? "")
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
		.replace(/call_[A-Za-z0-9|_-]+/g, "<call>")
		.replace(/notebook-\d+/g, "notebook-<n>")
		.replace(/:\d+:\d+/g, ":<line>")
		.replace(/\s+/g, " ")
		.slice(0, 240);
}

function exitCode(value: JsonObject): number | null {
	const details = object(value["details"]);
	const structured = object(value["structuredContent"]);
	const code =
		details["exit_code"] ??
		details["exitCode"] ??
		value["exit_code"] ??
		value["exitCode"] ??
		structured["exit_code"];
	if (typeof code === "number" && Number.isSafeInteger(code)) return code;
	// Some nested tools persist their structured return as one JSON text block.
	const text = textContent(value["content"]);
	if (text.startsWith("{") && text.length < 131_072) {
		try {
			const parsed = object(JSON.parse(text));
			const nested = parsed["exit_code"] ?? parsed["exitCode"];
			if (typeof nested === "number" && Number.isSafeInteger(nested))
				return nested;
		} catch {
			/* Plain tool output, not a structured exit observation. */
		}
	}
	return null;
}

function nativeScriptError(value: JsonObject): string {
	const content = value["content"];
	if (
		value["toolName"] !== "codemode" ||
		value["isError"] !== true ||
		!Array.isArray(object(value["details"])["calls"]) ||
		!Array.isArray(content) ||
		!/^Script failed\nWall time \d+\.\d seconds\nOutput:\n$/.test(
			textContent(content.slice(0, 1)),
		)
	)
		return "";
	// Pi appends the diagnostic after partial script output, which may print its own marker.
	const output = `\n${textContent(content.slice(1))}`;
	const marker = "\nScript error:\n";
	const start = output.lastIndexOf(marker);
	return start < 0 ? "" : output.slice(start + marker.length).trim();
}

export function assess(
	value: JsonObject,
	traceStatus?: string,
): {
	outcome: Outcome;
	exitCode: number | null;
	signature: string;
	preview: string;
} {
	const details = object(value["details"]);
	const code = exitCode(value);
	const error = string(value["error"]) || string(details["scriptError"]);
	const text =
		error || nativeScriptError(value) || textContent(value["content"]);
	let outcome: Outcome;
	// Tool details describe arbitrary domain data (for example, a watched agent's status).
	// Only the enclosing trace's status describes this tool execution.
	if (
		["error", "cancelled", "canceled", "aborted"].includes(traceStatus ?? "") ||
		value["isError"] === true ||
		error
	)
		outcome = "error";
	else if (traceStatus === "running" || traceStatus === "blocked")
		outcome = "incomplete";
	else if (code !== null && code !== 0) outcome = "nonzero";
	else if (traceStatus === "done" || value["isError"] === false) outcome = "ok";
	else outcome = "unknown";
	const group =
		outcome === "nonzero"
			? `exit ${code}`
			: outcome === "error"
				? signature(text) || outcome
				: "";
	return {
		outcome,
		exitCode: code,
		signature: group,
		preview: text.slice(0, 500),
	};
}
