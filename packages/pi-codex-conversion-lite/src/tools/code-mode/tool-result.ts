import {
	DEFAULT_CODE_MODE_OUTPUT_TOKENS,
	MAX_CODE_MODE_OUTPUT_TOKENS,
} from "./host-protocol.js";
import type { RuntimeContentItem, RuntimeResponse } from "./types.js";

const MAX_OUTPUT_IMAGE_COUNT = 4;
const MAX_OUTPUT_IMAGE_CHARS = 16 * 1024 * 1024;

export function toCodeModeToolResult(
	response: RuntimeResponse,
	maxTokens?: number,
) {
	const scriptError =
		response.kind === "result" ? response.errorText : undefined;
	const status = scriptError
		? `Script error: ${scriptError}`
		: response.kind === "yielded"
			? `Still running. Call wait({ cell_id: "${response.cellId}" })`
			: response.kind === "terminated"
				? "Script terminated"
				: "Script completed";
	let imageChars = 0;
	let imageCount = 0;
	let omittedImages = 0;
	const output = response.contentItems
		.map((item) => {
			const content = toPiContent(item);
			if (content?.type !== "image") return content;
			if (
				imageCount >= MAX_OUTPUT_IMAGE_COUNT ||
				imageChars + content.data.length > MAX_OUTPUT_IMAGE_CHARS
			) {
				omittedImages += 1;
				return undefined;
			}
			imageCount += 1;
			imageChars += content.data.length;
			return content;
		})
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
	output.unshift(
		...runningExecSessionGuidance(response.traces ?? []).map((text) => ({
			type: "text" as const,
			text,
		})),
	);
	if (omittedImages > 0)
		output.push({
			type: "text",
			text: `[${omittedImages} code-mode image${omittedImages === 1 ? "" : "s"} omitted]`,
		});
	const outputTokens = Math.min(
		MAX_CODE_MODE_OUTPUT_TOKENS,
		Math.max(
			1,
			maxTokens ?? response.maxOutputTokens ?? DEFAULT_CODE_MODE_OUTPUT_TOKENS,
		),
	);
	return {
		content: [
			{ type: "text" as const, text: status },
			...truncateTextContent(output, outputTokens * 4),
		],
		details: {
			codeMode: true,
			cellId: response.cellId,
			status: response.kind,
			...(response.traces ? { traces: response.traces } : {}),
			...(response.droppedTraceCount
				? { droppedTraceCount: response.droppedTraceCount }
				: {}),
			...(scriptError ? { scriptError } : {}),
		},
	};
}

function runningExecSessionGuidance(
	traces: NonNullable<RuntimeResponse["traces"]>,
): string[] {
	const sessionIds = new Set<number>();
	for (const trace of traces) {
		if (trace.status !== "done") continue;
		const details = trace.result?.details;
		const resultSessionId = numericSessionId(details);
		if (trace.name === "exec_command" && resultSessionId !== undefined) {
			sessionIds.add(resultSessionId);
			continue;
		}
		if (trace.name !== "write_stdin") continue;
		const inputSessionId = numericSessionId(trace.input);
		if (inputSessionId === undefined) continue;
		if (resultSessionId === undefined) sessionIds.delete(inputSessionId);
		else sessionIds.add(resultSessionId);
	}
	return [...sessionIds].map(
		(sessionId) =>
			`exec_command session ${sessionId} is still running. Continue with exec and tools.write_stdin({ session_id: ${sessionId} }); wait is only for a yielded exec cell_id`,
	);
}

function numericSessionId(value: unknown): number | undefined {
	if (
		value &&
		typeof value === "object" &&
		"session_id" in value &&
		typeof value.session_id === "number"
	)
		return value.session_id;
	return undefined;
}

function toPiContent(
	item: RuntimeContentItem,
):
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| undefined {
	if (item.type === "input_text" && typeof item.text === "string")
		return { type: "text", text: item.text };
	if (item.type === "input_image" && typeof item.image_url === "string") {
		const match = item.image_url.match(/^data:([^;,]+);base64,(.+)$/s);
		if (match) return { type: "image", mimeType: match[1]!, data: match[2]! };
	}
	return undefined;
}

function truncateTextContent<T extends { type: string; text?: string }>(
	content: T[],
	maxChars: number,
): T[] {
	let remaining = maxChars;
	let truncated = false;
	const output: T[] = [];
	for (const item of content) {
		if (item.type !== "text" || typeof item.text !== "string") {
			output.push(item);
			continue;
		}
		if (remaining <= 0) {
			if (!truncated) output.push({ ...item, text: "[Output truncated]" });
			truncated = true;
			continue;
		}
		if (item.text.length <= remaining) {
			remaining -= item.text.length;
			output.push(item);
			continue;
		}
		const text = `${item.text.slice(0, remaining)}\n[Output truncated]`;
		remaining = 0;
		truncated = true;
		output.push({ ...item, text });
	}
	return output;
}
