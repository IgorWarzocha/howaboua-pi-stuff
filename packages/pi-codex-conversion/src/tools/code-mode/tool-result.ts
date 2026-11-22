import {
	DEFAULT_CODE_MODE_OUTPUT_TOKENS,
	MAX_CODE_MODE_OUTPUT_TOKENS,
} from "./host-protocol.js";
import { referenceEmittedTraceImages } from "./trace-images.js";
import type { RuntimeContentItem, RuntimeResponse } from "./types.js";

const MAX_OUTPUT_IMAGE_COUNT = 4;
const MAX_OUTPUT_IMAGE_CHARS = 16 * 1024 * 1024;

export function toCodeModeToolResult(
	response: RuntimeResponse,
	maxTokens?: number,
) {
	const scriptError =
		response.kind === "result"
			? withScriptErrorRecovery(response.errorText)
			: undefined;
	const status = scriptError
		? `Script error: ${scriptError}`
		: response.kind === "yielded"
			? `Still running (exec cell "${response.cellId}"). Use wait once near expected completion; avoid short polling`
			: response.kind === "terminated"
				? "Script terminated"
				: undefined;
	const output = boundedCodeModeContent(response.contentItems);
	const outputTokens = Math.min(
		MAX_CODE_MODE_OUTPUT_TOKENS,
		Math.max(
			1,
			maxTokens ?? response.maxOutputTokens ?? DEFAULT_CODE_MODE_OUTPUT_TOKENS,
		),
	);
	const content = [
		...(status ? [{ type: "text" as const, text: status }] : []),
		...(response.execSessionIds ?? []).map((sessionId) => ({
			type: "text" as const,
			text: formatRunningExecSessionGuidance(sessionId),
		})),
		...truncateTextContent(output, outputTokens * 4),
	];
	const empty = !content.some(
		(item) => item.type !== "text" || item.text.length > 0,
	);
	if (empty) content.unshift({ type: "text", text: "OK" });
	return {
		...(response.terminate && response.kind === "result" && !scriptError
			? { terminate: true }
			: {}),
		content,
		details: {
			codeMode: true,
			cellId: response.cellId,
			...(response.opaqueOutputs?.length
				? {
						opaqueOutputs: response.opaqueOutputs,
						opaqueScope: response.opaqueScope,
					}
				: {}),
			status: response.kind,
			...(response.opaqueDeliveryId
				? { opaqueDeliveryId: response.opaqueDeliveryId }
				: {}),
			statusPrefix: Boolean(status) || empty,
			...(response.traces
				? {
						traces: referenceEmittedTraceImages(
							response.traces,
							content.filter((item) => item.type === "image"),
						),
					}
				: {}),
			...(response.droppedTraceCount
				? { droppedTraceCount: response.droppedTraceCount }
				: {}),
			...(scriptError ? { scriptError } : {}),
		},
	};
}

export function boundedCodeModeContent(items: RuntimeContentItem[]) {
	let imageChars = 0;
	let imageCount = 0;
	let omittedImages = 0;
	const output = items
		.map((item) => {
			const content = toPiContent(item);
			if (content?.type !== "image") return content;
			if (
				imageCount >= MAX_OUTPUT_IMAGE_COUNT ||
				imageChars + content.data.length > MAX_OUTPUT_IMAGE_CHARS
			) {
				omittedImages++;
				return undefined;
			}
			imageCount++;
			imageChars += content.data.length;
			return content;
		})
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
	if (omittedImages > 0)
		output.push({
			type: "text",
			text: `[${omittedImages} code-mode image${omittedImages === 1 ? "" : "s"} omitted]`,
		});
	return output;
}

function withScriptErrorRecovery(
	errorText: string | undefined,
): string | undefined {
	if (
		!errorText ||
		!/(?:Identifier ['"][^'"]+['"] has already been declared|\bTS2451\b.*Cannot redeclare block-scoped variable)/.test(
			errorText,
		)
	)
		return errorText;
	return `${errorText}\nRetry: wrap one-off const/let and their uses in { ... }. Need a new persistent binding? Use a fresh name. Reuse an existing binding only after verifying its value`;
}

export function formatRunningExecSessionGuidance(sessionId: number): string {
	return `Session ${sessionId} still running. Resume near completion with tools.write_stdin and an appropriate yield_time_ms; do not use wait`;
}

function toPiContent(item: RuntimeContentItem):
	| { type: "text"; text: string }
	| {
			type: "image";
			data: string;
			mimeType: string;
			detail?: "auto" | "high" | "original";
	  }
	| undefined {
	if (item.type === "input_text" && typeof item.text === "string")
		return { type: "text", text: item.text };
	if (item.type === "input_image" && typeof item.image_url === "string") {
		const match = item.image_url.match(/^data:([^;,]+);base64,(.+)$/s);
		if (match)
			return {
				type: "image",
				mimeType: match[1]!,
				data: match[2]!,
				...(item.detail && item.detail !== "low"
					? { detail: item.detail }
					: {}),
			};
	}
	return undefined;
}

function truncateTextContent<T extends { type: string; text?: string }>(
	content: T[],
	maxChars: number,
): T[] {
	const notice =
		"[Output truncated; later results may be missing. Narrow reads; missing help→own cell. NEVER repeat side effects for output]";
	let remaining = maxChars;
	let truncated = false;
	const output: T[] = [];
	for (const item of content) {
		if (item.type !== "text" || typeof item.text !== "string") {
			output.push(item);
			continue;
		}
		if (remaining <= 0) {
			if (!truncated) output.push({ ...item, text: notice });
			truncated = true;
			continue;
		}
		if (item.text.length <= remaining) {
			remaining -= item.text.length;
			output.push(item);
			continue;
		}
		const text = `${item.text.slice(0, remaining)}\n${notice}`;
		remaining = 0;
		truncated = true;
		output.push({ ...item, text });
	}
	return output;
}
