import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureCodeModeHostBinary } from "./binary.js";
import { discoverDynamicTools, getDynamicToolsDir } from "./config.js";
import { CodeModeHostClient } from "./host-client.js";
import {
	EXEC_DESCRIPTION,
	injectDynamicToolsPrompt,
	WAIT_DESCRIPTION,
} from "./prompt.js";
import {
	createCodeModeRenderTracker,
	type RenderContext,
	type RenderTheme,
	renderExecCall,
	renderTrackedCodeModeResult,
	renderWaitCall,
} from "./rendering.js";
import type { RuntimeContentItem, RuntimeResponse } from "./types.js";

const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_MAX_TOKENS = 10_000;
const REGISTRATION_KEY = Symbol.for("@howaboua/pi-dynamic-tools.registered");
const NOOP_RUNTIME = { async shutdown() {} };

export async function registerDynamicTools(
	pi: ExtensionAPI,
	toolsDir: string = getDynamicToolsDir(),
): Promise<{ shutdown(): Promise<void> }> {
	const sharedState = pi.events as typeof pi.events & {
		[REGISTRATION_KEY]?: object;
	};
	if (sharedState[REGISTRATION_KEY]) return NOOP_RUNTIME;
	const owner = {};
	const documentationPath = fileURLToPath(
		new URL("../DYNAMIC-TOOLS.md", import.meta.url),
	);
	pi.on("before_agent_start", (event) => {
		const systemPrompt = injectDynamicToolsPrompt(
			event.systemPrompt,
			discoverDynamicTools(toolsDir),
			documentationPath,
		);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});
	sharedState[REGISTRATION_KEY] = owner;
	let clientPromise: Promise<CodeModeHostClient> | undefined;
	const getClient = async () => {
		if (!clientPromise) {
			const pending = ensureCodeModeHostBinary().then(
				(binary) => new CodeModeHostClient({ binary, tools: [] }),
			);
			clientPromise = pending;
			void pending.catch(() => {
				if (clientPromise === pending) clientPromise = undefined;
			});
		}
		return clientPromise;
	};
	const renderTracker = createCodeModeRenderTracker();
	const renderResult = (
		result: Parameters<typeof renderTrackedCodeModeResult>[0],
		options: Parameters<typeof renderTrackedCodeModeResult>[1],
		theme: RenderTheme,
		context: RenderContext,
	) =>
		renderTrackedCodeModeResult(result, options, theme, context, renderTracker);
	pi.registerTool({
		name: "exec",
		label: "Exec",
		description: EXEC_DESCRIPTION,
		promptSnippet: "Discover or compose dynamic tools with JavaScript.",
		parameters: Type.Object({
			code: Type.String({
				description: "JavaScript source; no markdown fences.",
			}),
		}),
		async execute(id, params, signal, onUpdate, ctx) {
			renderTracker.start(id);
			try {
				const tools = discoverDynamicTools(toolsDir);
				const client = await getClient();
				const response = await client.execute(
					params.code,
					{ cwd: ctx.cwd, onUpdate },
					signal,
					tools,
				);
				renderTracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toToolResult(response);
			} catch (error) {
				renderTracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { code?: unknown },
			theme: RenderTheme,
			context: RenderContext,
		) => renderExecCall(args, theme, context, renderTracker)) as any,
		renderResult: renderResult as any,
	});
	pi.registerTool({
		name: "wait",
		label: "Wait",
		description: WAIT_DESCRIPTION,
		promptSnippet: "Resume or terminate an exec cell.",
		parameters: Type.Object({
			cell_id: Type.String({ description: "Yielded exec cell ID." }),
			yield_time_ms: Type.Optional(
				Type.Number({
					minimum: 0,
					description:
						"Wait duration in ms. Match the expected remaining runtime; use 60000 or more for long tasks. Default 10000.",
				}),
			),
			max_tokens: Type.Optional(
				Type.Number({
					minimum: 1,
					description: "Output token limit (default 10000).",
				}),
			),
			terminate: Type.Optional(
				Type.Boolean({ description: "Stop the cell instead of waiting." }),
			),
		}),
		async execute(id, params, signal, onUpdate, ctx) {
			renderTracker.start(id);
			try {
				const client = await getClient();
				const response = params.terminate
					? await client.terminate(params.cell_id)
					: await client.wait(
							params.cell_id,
							params.yield_time_ms ?? DEFAULT_WAIT_MS,
							{ cwd: ctx.cwd, onUpdate },
							signal,
						);
				renderTracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toToolResult(response, params.max_tokens);
			} catch (error) {
				renderTracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { cell_id?: unknown; terminate?: unknown },
			theme: RenderTheme,
			context: RenderContext,
		) => renderWaitCall(args, theme, context, renderTracker)) as any,
		renderResult: renderResult as any,
	});
	return {
		async shutdown() {
			if (sharedState[REGISTRATION_KEY] === owner)
				delete sharedState[REGISTRATION_KEY];
			const pending = clientPromise;
			clientPromise = undefined;
			if (!pending) return;
			try {
				await (await pending).shutdown();
			} catch {
				// Startup failure already reached the caller.
			}
		},
	};
}

function toToolResult(response: RuntimeResponse, maxTokens?: number) {
	if (response.kind === "result" && response.errorText)
		throw new Error(`Script error: ${response.errorText}`);
	const status =
		response.kind === "yielded"
			? `Script running with cell ID ${response.cellId}`
			: response.kind === "terminated"
				? "Script terminated"
				: "Script completed";
	const output = response.contentItems
		.map(toPiContent)
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
	const content = [
		{ type: "text" as const, text: status },
		...truncateTextContent(
			output,
			(maxTokens ?? response.maxOutputTokens ?? DEFAULT_MAX_TOKENS) * 4,
		),
	];
	return {
		content,
		details: { cellId: response.cellId, status: response.kind },
	};
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
	return content.map((item) => {
		if (item.type !== "text" || typeof item.text !== "string") return item;
		if (remaining <= 0) return { ...item, text: "[Output truncated]" };
		if (item.text.length <= remaining) {
			remaining -= item.text.length;
			return item;
		}
		const text = `${item.text.slice(0, remaining)}\n[Output truncated]`;
		remaining = 0;
		return { ...item, text };
	});
}
