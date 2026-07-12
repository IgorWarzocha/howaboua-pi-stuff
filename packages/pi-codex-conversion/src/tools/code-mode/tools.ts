import { dirname, join } from "node:path";
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
import type {
	CodeModeToolDefinition,
	RuntimeContentItem,
	RuntimeResponse,
} from "./types.js";

const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_MAX_TOKENS = 10_000;
const REGISTRATION_KEY = Symbol.for("@howaboua/pi-codex-conversion.code-mode");

interface CodeModeToolProvider {
	getTools(): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
}

interface SharedCodeModeRuntime {
	providers: Map<object, CodeModeToolProvider>;
	clientPromise?: Promise<CodeModeHostClient> | undefined;
	shutdownHost(): Promise<void>;
}

export interface RegisterCodeModeToolsOptions {
	getTools(): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
}

export async function registerDynamicTools(
	pi: ExtensionAPI,
	toolsDir: string = getDynamicToolsDir(),
	options: { isActive?(ctx: unknown): boolean } = {},
): Promise<{ shutdown(): Promise<void> }> {
	const modulePath = fileURLToPath(import.meta.url);
	const packageRoot = dirname(dirname(dirname(dirname(modulePath))));
	const documentationPath = join(
		packageRoot,
		"src",
		"tools",
		"code-mode",
		"DYNAMIC-TOOLS.md",
	);
	return registerCodeModeTools(pi, {
		getTools: () => discoverDynamicTools(toolsDir),
		documentationPath,
		...options,
	});
}

export async function registerCodeModeTools(
	pi: ExtensionAPI,
	options: RegisterCodeModeToolsOptions,
): Promise<{ shutdown(): Promise<void> }> {
	const sharedState = pi.events as typeof pi.events & {
		[REGISTRATION_KEY]?: SharedCodeModeRuntime;
	};
	let shared = sharedState[REGISTRATION_KEY];
	if (!shared) {
		shared = createSharedCodeModeRuntime(pi);
		sharedState[REGISTRATION_KEY] = shared;
	}
	const providerId = {};
	shared.providers.set(providerId, options);
	let active = true;
	return {
		async shutdown() {
			if (!active) return;
			active = false;
			shared.providers.delete(providerId);
			if (shared.providers.size > 0) return;
			await shared.shutdownHost();
		},
	};
}

function createSharedCodeModeRuntime(pi: ExtensionAPI): SharedCodeModeRuntime {
	const runtime: SharedCodeModeRuntime = {
		providers: new Map(),
		async shutdownHost() {
			const pending = runtime.clientPromise;
			runtime.clientPromise = undefined;
			if (!pending) return;
			try {
				await (await pending).shutdown();
			} catch {
				// Startup failure already reached the caller.
			}
		},
	};
	const collectTools = (ctx?: unknown): CodeModeToolDefinition[] => {
		const tools = [...runtime.providers.values()]
			.filter((provider) => !provider.isActive || provider.isActive(ctx))
			.flatMap((provider) => provider.getTools());
		const byName = new Map<string, CodeModeToolDefinition>();
		const unique: CodeModeToolDefinition[] = [];
		for (const tool of tools) {
			const previous = byName.get(tool.name);
			if (previous) {
				if (
					"sourcePath" in previous &&
					"sourcePath" in tool &&
					previous.sourcePath === tool.sourcePath
				)
					continue;
				throw new Error(`Duplicate code-mode tool: ${tool.name}`);
			}
			byName.set(tool.name, tool);
			unique.push(tool);
		}
		return unique;
	};
	const getClient = async () => {
		if (!runtime.clientPromise) {
			const pending = ensureCodeModeHostBinary().then(
				(binary) => new CodeModeHostClient({ binary, tools: [] }),
			);
			runtime.clientPromise = pending;
			void pending.catch(() => {
				if (runtime.clientPromise === pending)
					runtime.clientPromise = undefined;
			});
		}
		return runtime.clientPromise;
	};
	pi.on("before_agent_start", (event, ctx) => {
		const activeProviders = [...runtime.providers.values()].filter(
			(provider) => !provider.isActive || provider.isActive(ctx),
		);
		if (activeProviders.length === 0) return undefined;
		const tools = collectTools(ctx);
		const documentationPath = activeProviders.find(
			(provider) => provider.documentationPath,
		)?.documentationPath;
		if (!documentationPath) return undefined;
		const systemPrompt = injectDynamicToolsPrompt(
			event.systemPrompt,
			tools,
			documentationPath,
		);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});
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
		promptSnippet: "Compose tools with JavaScript.",
		parameters: Type.Object({
			code: Type.String({
				description: "JavaScript source; no markdown fences.",
			}),
		}),
		async execute(id, params, signal, onUpdate, ctx) {
			renderTracker.start(id);
			try {
				const response = await (await getClient()).execute(
					params.code,
					{ cwd: ctx.cwd, extensionContext: ctx, onUpdate },
					signal,
					collectTools(ctx),
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
				Type.Integer({
					minimum: 0,
					description:
						"Wait duration in ms. Match the expected remaining runtime; use 60000 or more for long tasks. Default 10000.",
				}),
			),
			max_tokens: Type.Optional(
				Type.Integer({
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
							{ cwd: ctx.cwd, extensionContext: ctx, onUpdate },
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
	return runtime;
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
	return {
		content: [
			{ type: "text" as const, text: status },
			...truncateTextContent(
				output,
				(maxTokens ?? response.maxOutputTokens ?? DEFAULT_MAX_TOKENS) * 4,
			),
		],
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
