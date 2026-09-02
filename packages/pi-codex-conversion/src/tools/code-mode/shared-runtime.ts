import { ensureCodeModeHostBinary } from "./binary.js";
import { CodeModeHostClient } from "./host-client.js";
import { createNotebookControlProxy } from "./notebook-tool.ts";
import { codeModeGlobalName } from "./tool-identity.ts";
import { CodeModeNestedRenderStore } from "./trace-render-state.js";
import type {
	CodeModeToolDefinition,
	NotebookControlRequest,
	NotebookControlResult,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";

export type CodeModeExecutionKind = "code" | "notebook";

export interface NotebookRuntimeOptions {
	maxHeapMiB: number;
	agentDir: string;
	profile?: string | undefined;
}

export interface CodeModeExecutionClient {
	execute(source: string, context: ToolExecutionContext, signal?: AbortSignal, tools?: CodeModeToolDefinition[]): Promise<RuntimeResponse>;
	wait(cellId: string, yieldTimeMs: number, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse>;
	terminate(cellId: string, context: ToolExecutionContext, signal?: AbortSignal): Promise<RuntimeResponse>;
	checkpoint?(): Promise<void>;
	controlNotebook?(request: NotebookControlRequest, context: ToolExecutionContext, signal?: AbortSignal): Promise<NotebookControlResult>;
	shutdown(): Promise<void>;
}

export interface CodeModeToolProvider {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	providesRenderers?: boolean | undefined;
	richRendering?(): boolean;
	executionKind?(ctx: unknown): CodeModeExecutionKind;
	notebookOptions?(ctx: unknown): NotebookRuntimeOptions;
}

export class SharedCodeModeRuntime {
	readonly providers = new Map<object, CodeModeToolProvider>();
	readonly renderStore = new CodeModeNestedRenderStore();
	private clientPromise: Promise<CodeModeHostClient> | undefined;
	private notebookClientPromise: Promise<CodeModeExecutionClient> | undefined;
	private notebookClientOptionsKey: string | undefined;
	private notebookClientTransition: Promise<void> = Promise.resolve();
	private clientStartupAbort: AbortController | undefined;
	private customPromptToolsSnapshot: CodeModeToolDefinition[] | undefined;
	private promptSectionSnapshot: string | undefined;

	addProvider(provider: CodeModeToolProvider): object {
		const id = {};
		this.providers.set(id, provider);
		return id;
	}

	removeProvider(id: object): void {
		this.providers.delete(id);
	}

	activeProviders(ctx?: unknown): CodeModeToolProvider[] {
		return [...this.providers.values()].filter(
			(provider) => !provider.isActive || provider.isActive(ctx),
		);
	}

	collectTools(ctx?: unknown): CodeModeToolDefinition[] {
		const tools = this.collectProviderTools(ctx);
		return this.customPromptToolsSnapshot
			? applyCustomPromptState(tools, this.customPromptToolsSnapshot)
			: tools;
	}

	refreshPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		const tools = this.collectProviderTools(ctx);
		this.customPromptToolsSnapshot = tools.filter(isCustomTool);
		return tools;
	}

	resetPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		this.promptSectionSnapshot = undefined;
		return this.refreshPromptTools(ctx);
	}

	collectPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		if (!this.customPromptToolsSnapshot) return this.refreshPromptTools(ctx);
		const liveProgrammaticTools = this.collectProviderTools(ctx)
			.filter((tool) => !isCustomTool(tool));
		return [...liveProgrammaticTools, ...this.customPromptToolsSnapshot];
	}

	setPromptSection(section: string): void {
		this.promptSectionSnapshot = section;
	}

	getPromptSection(): string | undefined {
		return this.promptSectionSnapshot;
	}

	collectRenderTools(): CodeModeToolDefinition[] {
		return collectUniqueTools(
			[...this.providers.values()].filter((provider) => provider.providesRenderers),
		);
	}

	useRichRendering(): boolean {
		return [...this.providers.values()].find((provider) => provider.richRendering)
			?.richRendering?.() ?? true;
	}

	executionKind(ctx?: unknown): CodeModeExecutionKind {
		const explicit = new Set(
			this.activeProviders(ctx)
				.map((provider) => provider.executionKind?.(ctx))
				.filter((kind): kind is CodeModeExecutionKind => Boolean(kind)),
		);
		if (explicit.size > 1) throw new Error("Conflicting code-mode execution runtimes are active");
		return explicit.values().next().value ?? "code";
	}

	async getClient(ctx?: unknown): Promise<CodeModeExecutionClient> {
		if (this.executionKind(ctx) === "notebook") return this.getNotebookClient(ctx);
		if (!this.clientPromise) {
			const startupAbort = new AbortController();
			const pending = ensureCodeModeHostBinary(startupAbort.signal).then(
				(binary) => new CodeModeHostClient({
					binary,
					tools: [],
					renderStore: this.renderStore,
				}),
			);
			this.clientPromise = pending;
			this.clientStartupAbort = startupAbort;
			void pending.then(
				() => {
					if (this.clientPromise === pending) this.clientStartupAbort = undefined;
				},
				() => {
					if (this.clientPromise !== pending) return;
					this.clientPromise = undefined;
					this.clientStartupAbort = undefined;
				},
			);
		}
		return this.clientPromise;
	}

	private getNotebookClient(ctx?: unknown): Promise<CodeModeExecutionClient> {
		const options = this.activeProviders(ctx).find((provider) => provider.notebookOptions)?.notebookOptions?.(ctx);
		if (!options) return Promise.reject(new Error("Notebook Code Mode runtime options are unavailable"));
		const key = JSON.stringify([options.agentDir, options.maxHeapMiB, options.profile ?? null]);
		if (this.notebookClientPromise && this.notebookClientOptionsKey === key) return this.notebookClientPromise;
		const transition = this.notebookClientTransition.then(async () => {
			if (this.notebookClientPromise && this.notebookClientOptionsKey !== key) {
				const previous = this.notebookClientPromise;
				this.notebookClientPromise = undefined;
				this.notebookClientOptionsKey = undefined;
				await (await previous).shutdown();
			}
			if (!this.notebookClientPromise) {
				const pending = import("../notebook-mode/client.ts").then(
					({ NotebookCodeModeClient }) =>
						new NotebookCodeModeClient(options, this.renderStore),
				);
				this.notebookClientPromise = pending;
				this.notebookClientOptionsKey = key;
				void pending.catch(() => {
					if (this.notebookClientPromise !== pending) return;
					this.notebookClientPromise = undefined;
					this.notebookClientOptionsKey = undefined;
				});
			}
			return this.notebookClientPromise;
		});
		this.notebookClientTransition = transition.then(() => undefined, () => undefined);
		return transition;
	}

	prepare(ctx?: unknown): Promise<void> | undefined {
		if (this.activeProviders(ctx).length === 0) return undefined;
		return this.getClient(ctx).then(() => undefined);
	}

	async checkpointNotebook(): Promise<void> {
		const pending = this.notebookClientPromise;
		if (!pending) return;
		const client = await pending;
		await client.checkpoint?.();
	}

	async controlNotebook(
		request: NotebookControlRequest,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<NotebookControlResult> {
		if (this.executionKind(context.extensionContext) !== "notebook") {
			throw new Error("notebook is available only in Notebook Mode");
		}
		const client = await this.getNotebookClient(context.extensionContext);
		if (!client.controlNotebook) throw new Error("Notebook lifecycle controls are unavailable");
		return client.controlNotebook(request, context, signal);
	}

	async shutdownHost(): Promise<void> {
		await this.notebookClientTransition;
		while (this.clientPromise) {
			const pending = this.clientPromise;
			this.clientPromise = undefined;
			this.clientStartupAbort?.abort();
			this.clientStartupAbort = undefined;
			try {
				await (await pending).shutdown();
			} catch {
				// Startup failure already reached the caller.
			}
		}
		while (this.notebookClientPromise) {
			const pending = this.notebookClientPromise;
			this.notebookClientPromise = undefined;
			this.notebookClientOptionsKey = undefined;
			try {
				await (await pending).shutdown();
			} catch {
				// Startup failure already reached the caller.
			}
		}
	}

	private collectProviderTools(ctx?: unknown): CodeModeToolDefinition[] {
		const tools = collectUniqueTools(this.activeProviders(ctx), ctx);
		if (this.executionKind(ctx) !== "notebook") return tools;
		if (tools.some((tool) => tool.name === "notebook"))
			throw new Error("Duplicate code-mode tool: notebook");
		return [...tools, createNotebookControlProxy(this)];
	}
}

function isCustomTool(tool: CodeModeToolDefinition): boolean {
	return "command" in tool;
}

function applyCustomPromptState(
	tools: CodeModeToolDefinition[],
	customPromptTools: CodeModeToolDefinition[],
): CodeModeToolDefinition[] {
	const customPromptState = new Map(
		customPromptTools.map((tool) => [tool.name, tool.deferLoading]),
	);
	return tools.map((tool) =>
		isCustomTool(tool)
			? {
					...tool,
					deferLoading: customPromptState.get(tool.name) ?? true,
				}
			: tool,
	);
}

function collectUniqueTools(
	providers: CodeModeToolProvider[],
	ctx?: unknown,
): CodeModeToolDefinition[] {
	const tools = providers.flatMap((provider) => provider.getTools(ctx));
	const byName = new Map<string, CodeModeToolDefinition>();
	const unique: CodeModeToolDefinition[] = [];
	for (const tool of tools) {
		const globalName = codeModeGlobalName(tool.name);
		const previous = byName.get(globalName);
		if (previous) {
			if (
				previous.name === tool.name &&
				"sourcePath" in previous &&
				"sourcePath" in tool &&
				previous.sourcePath === tool.sourcePath
			)
				continue;
			if (previous.name !== tool.name) {
				throw new Error(
					`Code Mode tool names ${previous.name} and ${tool.name} both translate to ${globalName}`,
				);
			}
			throw new Error(`Duplicate code-mode tool: ${tool.name}`);
		}
		byName.set(globalName, tool);
		unique.push(tool);
	}
	return unique;
}
