import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureCodeModeHostBinary } from "./binary.js";
import { discoverDynamicTools, getDynamicToolsDir } from "./config.js";
import { CodeModeHostClient } from "./host-client.js";
import { MAX_CODE_MODE_OUTPUT_TOKENS } from "./host-protocol.js";
import {
	EXEC_DESCRIPTION,
	injectDynamicToolsPrompt,
	WAIT_DESCRIPTION,
} from "./prompt.js";
import {
	type RenderContext,
	type RenderTheme,
	renderExecCall,
	renderTrackedCodeModeResult,
	renderWaitCall,
} from "./rendering.js";
import { createCodeModeRenderTracker } from "./render-tracker.js";
import type { CodeModeToolDefinition } from "./types.js";
import { toCodeModeToolResult } from "./tool-result.js";

const DEFAULT_WAIT_MS = 10_000;
// Pi event handlers cannot be unregistered. Keep one process-lifetime runtime
// on pi.events so extension re-registration reuses listeners instead of stacking them.
const REGISTRATION_KEY = Symbol.for("@howaboua/pi-codex-conversion.code-mode");

interface CodeModeToolProvider {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	providesRenderers?: boolean | undefined;
	richRendering?(): boolean;
}

interface SharedCodeModeRuntime {
	providers: Map<object, CodeModeToolProvider>;
	clientPromise?: Promise<CodeModeHostClient> | undefined;
	shutdownHost(): Promise<void>;
}

export interface RegisterCodeModeToolsOptions {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	providesRenderers?: boolean | undefined;
	richRendering?(): boolean;
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
	const collectToolsFrom = (
		providers: CodeModeToolProvider[],
		ctx?: unknown,
	): CodeModeToolDefinition[] => {
		const tools = providers.flatMap((provider) => provider.getTools(ctx));
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
	const collectTools = (ctx?: unknown): CodeModeToolDefinition[] =>
		collectToolsFrom(
			[...runtime.providers.values()].filter(
				(provider) => !provider.isActive || provider.isActive(ctx),
			),
			ctx,
		);
	const collectRenderTools = (): CodeModeToolDefinition[] =>
		collectToolsFrom(
			[...runtime.providers.values()].filter(
				(provider) => provider.providesRenderers,
			),
		);
	const useRichRendering = (): boolean =>
		[...runtime.providers.values()].find((provider) => provider.richRendering)
			?.richRendering?.() ?? true;
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
	pi.on("tool_result", (event) => {
		if (
			(event.toolName === "exec" || event.toolName === "wait") &&
			event.details &&
			typeof event.details === "object" &&
			"codeMode" in event.details &&
			event.details.codeMode === true &&
			"scriptError" in event.details &&
			typeof event.details.scriptError === "string"
		)
			return { isError: true };
		return undefined;
	});
	const renderTracker = createCodeModeRenderTracker();
	const renderResult = (
		result: Parameters<typeof renderTrackedCodeModeResult>[0],
		options: Parameters<typeof renderTrackedCodeModeResult>[1],
		theme: RenderTheme,
		context: RenderContext,
	) =>
		renderTrackedCodeModeResult(
			result,
			options,
			theme,
			context,
			renderTracker,
			collectRenderTools(),
			useRichRendering(),
		);
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
				return toCodeModeToolResult(response);
			} catch (error) {
				renderTracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { code?: unknown },
			theme: RenderTheme,
			context: RenderContext,
		) =>
			renderExecCall(
				args,
				theme,
				context,
				renderTracker,
				useRichRendering(),
			)) as any,
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
					maximum: MAX_CODE_MODE_OUTPUT_TOKENS,
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
				const context = { cwd: ctx.cwd, extensionContext: ctx, onUpdate };
				const response = params.terminate
					? await client.terminate(params.cell_id, context, signal)
					: await client.wait(
							params.cell_id,
							params.yield_time_ms ?? DEFAULT_WAIT_MS,
							context,
							signal,
						);
				renderTracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toCodeModeToolResult(response, params.max_tokens);
			} catch (error) {
				renderTracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { cell_id?: unknown; terminate?: unknown },
			theme: RenderTheme,
			context: RenderContext,
		) =>
			renderWaitCall(
				args,
				theme,
				context,
				renderTracker,
				useRichRendering(),
			)) as any,
		renderResult: renderResult as any,
	});
	return runtime;
}
