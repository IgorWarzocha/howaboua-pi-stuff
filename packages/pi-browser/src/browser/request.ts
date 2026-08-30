import { type BrowserOperation, OPERATION_ORDER } from "./operation.js";
import { isRecordValue, parseActionRequest } from "./parse-operation.js";

export type BrowserRequest =
	| { help: true }
	| { operations: BrowserOperation[] };

const BATCH_FIELDS = new Set(["host", "response_length", ...OPERATION_ORDER]);

export function parseBrowserRequest(input: unknown): BrowserRequest {
	let value = input;
	if (typeof input === "string") {
		const text = input.trim();
		if (text === "help") return { help: true };
		try {
			value = JSON.parse(text);
		} catch (error) {
			throw new Error(
				`input must be "help" or valid JSON: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
	if (!isRecordValue(value)) {
		throw new Error("input must be a JSON object");
	}
	if (Object.hasOwn(value, "action")) {
		const operation = parseActionRequest(value);
		return operation.action === "help"
			? { help: true }
			: { operations: [operation] };
	}
	const unknown = Object.keys(value).filter((key) => !BATCH_FIELDS.has(key));
	if (unknown.length > 0) {
		throw new Error(`unknown browser field(s): ${unknown.join(", ")}`);
	}
	if (value["host"] !== undefined) {
		throw new Error("SSH browser routing is disabled");
	}
	const responseLength = value["response_length"] ?? "medium";
	if (
		responseLength !== "short" &&
		responseLength !== "medium" &&
		responseLength !== "long"
	) {
		throw new Error("response_length must be one of: short, medium, long");
	}
	const operations: BrowserOperation[] = [];
	for (const action of OPERATION_ORDER) {
		const items = value[action];
		if (items === undefined) continue;
		if (!Array.isArray(items) || items.length === 0) {
			throw new Error(`${action} must be a non-empty array`);
		}
		for (const [index, item] of items.entries()) {
			if (!isRecordValue(item)) {
				throw new Error(`${action}[${index}] must be an object`);
			}
			const reserved = ["action", "host", "response_length"].filter((key) =>
				Object.hasOwn(item, key),
			);
			if (reserved.length > 0) {
				throw new Error(
					`${action}[${index}] has top-level field(s): ${reserved.join(", ")}`,
				);
			}
			const parsed = parseActionRequest({
				action,
				...item,
				...(action === "open" || action === "find"
					? { response_length: responseLength }
					: {}),
			});
			if (parsed.action === "help") {
				throw new Error("help is not a batch operation");
			}
			operations.push(parsed);
		}
	}
	if (operations.length === 0) {
		throw new Error(
			`provide at least one operation: ${OPERATION_ORDER.join(", ")}`,
		);
	}
	return { operations };
}
