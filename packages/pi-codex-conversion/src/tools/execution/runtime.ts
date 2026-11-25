import type { ToolDetailsMode } from "../../adapter/activation/config-contract.ts";
import { OpaqueResultState } from "../code-mode/opaque-result-state.ts";
import type {
	ExtensionContext,
	ToolLoadout,
	ToolLoadoutChanges,
} from "@earendil-works/pi-coding-agent";
import { ensureCodeModeHostBinary } from "../code-mode/binary.js";
import { CodeModeHostClient } from "../code-mode/host-client.js";
import { createNotebookControlProxy } from "../ts-mode/notebook-tool.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import { CodeModeNestedRenderStore } from "../code-mode/trace-render-state.js";
import { prepareCodeModeToolInput } from "../code-mode/tool-input.ts";
import {
	formatVmBindingInventory,
	type VmBindingInventory,
} from "../vm-mode/binding-inventory.ts";
import type {
	CodeModeToolDefinition,
	NotebookControlRequest,
	NotebookControlResult,
	RuntimeResponse,
	ToolExecutionContext,
} from "../code-mode/types.js";

export type CodeModeExecutionKind = "code" | "ts" | "vm";

export interface OpaqueContextGuard {
	lazy: boolean;
	scope: string;
	owner: string;
	generation: number;
	deliver(response: RuntimeResponse, callId: string): string;
	valid(): Promise<boolean>;
	resolveScope(): Promise<string>;
}

export interface ExecutionClientOptions {
	maxHeapMiB: number;
	agentDir: string;
	profile?: string | undefined;
}

export interface CodeModeClientOptions {
	maxHeapMiB: number;
	agentDir: string;
	prepareToolInput: typeof prepareCodeModeToolInput;
}

export interface NotebookClientOptions extends CodeModeClientOptions {
	profile?: string | undefined;
}

export interface CodeModeExecutionClient {
	execute(
		source: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
		tools?: CodeModeToolDefinition[],
	): Promise<RuntimeResponse>;
	wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse>;
	terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse>;
	checkpoint?(): Promise<void>;
	bindingInventory?(context: ToolExecutionContext): Promise<VmBindingInventory>;
	controlNotebook?(
		request: NotebookControlRequest,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<NotebookControlResult>;
	shutdown(): Promise<void>;
	clearOpaqueResults?(): void;
}

export interface CodeModeToolProvider {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	prepareLoadout?(loadout: ToolLoadout): ToolLoadoutChanges | undefined;
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	heavySystemPromptOverwrite?(): boolean;
	providesRenderers?: boolean | undefined;
	toolDetails?(): ToolDetailsMode;
	executionKind?(ctx: unknown): CodeModeExecutionKind;
	executionClientOptions?(ctx: unknown): ExecutionClientOptions;
	opaqueResultScope?(ctx: ExtensionContext): Promise<string>;
	lazyOpaqueResultScope?(): boolean;
	deliverOpaqueResponse?(
		response: RuntimeResponse,
		callId: string,
		scope: string,
		ctx: ExtensionContext,
	): string;
}

export class SharedCodeModeRuntime {
	readonly providers = new Map<object, CodeModeToolProvider>();
	readonly renderStore = new CodeModeNestedRenderStore();
	private clientPromise: Promise<CodeModeHostClient> | undefined;
	private runtimeClientPromise: Promise<CodeModeExecutionClient> | undefined;
	private runtimeClientOptionsKey: string | undefined;
	private runtimeClientTransition: Promise<void> = Promise.resolve();
	private clientStartupAbort: AbortController | undefined;
	private customPromptToolsSnapshot: CodeModeToolDefinition[] | undefined;
	private readonly opaqueResults = new OpaqueResultState(
		(ctx) => this.activeProviders(ctx),
		(ctx) => this.opaqueOwner(ctx),
	);

	opaqueContextGuard(ctx: ExtensionContext): Promise<OpaqueContextGuard> {
		return this.opaqueResults.opaqueContextGuard(ctx);
	}

	deliverOpaqueResponse(
		response: RuntimeResponse,
		callId: string,
		guard?: OpaqueContextGuard,
	): RuntimeResponse {
		return this.opaqueResults.deliverOpaqueResponse(response, callId, guard);
	}

	completedCell(
		cellId: string,
		ctx: ExtensionContext,
	): Promise<RuntimeResponse | undefined> {
		return this.opaqueResults.completedCell(cellId, ctx);
	}

	clearOpaqueResults(): void {
		this.opaqueResults.clear();
		for (const pending of [this.clientPromise, this.runtimeClientPromise])
			void pending?.then(
				(client) => client.clearOpaqueResults?.(),
				() => undefined,
			);
	}

	heavySystemPromptOverwrite(ctx: ExtensionContext): boolean {
		return this.activeProviders(ctx).some((provider) =>
			provider.heavySystemPromptOverwrite?.(),
		);
	}

	private opaqueOwner(ctx: ExtensionContext): string {
		return JSON.stringify([
			ctx.sessionManager.getSessionId(),
			ctx.model?.api,
			ctx.model?.provider,
			ctx.model?.id,
			ctx.model?.baseUrl,
			this.executionKind(ctx),
			this.collectTools(ctx).some(
				(tool) => "invoke" in tool && tool.opaqueResult,
			),
		]);
	}

	addProvider(provider: CodeModeToolProvider): object {
		const id = {};
		this.providers.set(id, provider);
		return id;
	}

	removeProvider(id: object): void {
		this.providers.delete(id);
	}

	prepareLoadout(loadout: ToolLoadout): ToolLoadoutChanges {
		const changes = [...this.providers.values()].map((provider) =>
			provider.prepareLoadout?.(loadout),
		);
		return {
			hiddenDeclarations: changes.flatMap(
				(change) => change?.hiddenDeclarations ?? [],
			),
			descriptions: Object.assign(
				{},
				...changes.map((change) => change?.descriptions),
			),
		};
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

	resetPromptTools(): void {
		// Capture on the next prompt, after every session/model handler has settled activation.
		this.customPromptToolsSnapshot = undefined;
	}

	collectPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		if (!this.customPromptToolsSnapshot) return this.refreshPromptTools(ctx);
		const liveProgrammaticTools = this.collectProviderTools(ctx).filter(
			(tool) => !isCustomTool(tool),
		);
		return [...liveProgrammaticTools, ...this.customPromptToolsSnapshot];
	}

	collectRenderTools(): CodeModeToolDefinition[] {
		return collectUniqueTools(
			[...this.providers.values()].filter(
				(provider) => provider.providesRenderers,
			),
		);
	}

	toolDetails(): ToolDetailsMode {
		for (const provider of this.providers.values())
			if (provider.toolDetails) return provider.toolDetails();
		return "preview";
	}

	executionKind(ctx?: unknown): CodeModeExecutionKind {
		const explicit = new Set(
			this.activeProviders(ctx)
				.map((provider) => provider.executionKind?.(ctx))
				.filter((kind): kind is CodeModeExecutionKind => Boolean(kind)),
		);
		if (explicit.size > 1)
			throw new Error("Conflicting code-mode execution runtimes are active");
		const kind = explicit.values().next().value ?? "code";
		switch (kind) {
			case "code":
			case "ts":
			case "vm":
				return kind;
			default:
				throw new Error(
					"Unsupported Code execution mode. Reload Pi and choose a supported mode.",
				);
		}
	}

	async getClient(ctx?: unknown): Promise<CodeModeExecutionClient> {
		const kind = this.executionKind(ctx);
		if (kind !== "code") return this.getRuntimeClient(ctx, kind);
		if (!this.clientPromise) {
			const startupAbort = new AbortController();
			const pending = ensureCodeModeHostBinary(startupAbort.signal).then(
				(binary) =>
					new CodeModeHostClient({
						binary,
						tools: [],
						renderStore: this.renderStore,
					}),
			);
			this.clientPromise = pending;
			this.clientStartupAbort = startupAbort;
			void pending.then(
				() => {
					if (this.clientPromise === pending)
						this.clientStartupAbort = undefined;
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

	private getRuntimeClient(
		ctx: unknown,
		kind: Exclude<CodeModeExecutionKind, "code">,
	): Promise<CodeModeExecutionClient> {
		const options = this.activeProviders(ctx)
			.find((provider) => provider.executionClientOptions)
			?.executionClientOptions?.(ctx);
		if (!options)
			return Promise.reject(
				new Error("Execution settings are unavailable. Reload Pi and retry."),
			);
		const key = JSON.stringify([
			kind,
			options.agentDir,
			options.maxHeapMiB,
			kind === "ts" ? (options.profile ?? null) : null,
		]);
		if (this.runtimeClientPromise && this.runtimeClientOptionsKey === key)
			return this.runtimeClientPromise;
		const transition = this.runtimeClientTransition.then(async () => {
			if (this.runtimeClientPromise && this.runtimeClientOptionsKey !== key) {
				const previous = this.runtimeClientPromise;
				this.runtimeClientPromise = undefined;
				this.runtimeClientOptionsKey = undefined;
				await (await previous).shutdown();
			}
			if (!this.runtimeClientPromise) {
				// Native lazy imports cannot resolve Pi's loader aliases; inject eager validation.
				const clientOptions = {
					...options,
					prepareToolInput: prepareCodeModeToolInput,
				};
				const pending =
					kind === "vm"
						? import("../vm-mode/client.ts").then(
								({ VmCodeClient }) =>
									new VmCodeClient(clientOptions, this.renderStore),
							)
						: import("../ts-mode/client.ts").then(
								({ TsNotebookClient }) =>
									new TsNotebookClient(clientOptions, this.renderStore),
							);
				this.runtimeClientPromise = pending;
				this.runtimeClientOptionsKey = key;
				void pending.catch(() => {
					if (this.runtimeClientPromise !== pending) return;
					this.runtimeClientPromise = undefined;
					this.runtimeClientOptionsKey = undefined;
				});
			}
			return this.runtimeClientPromise;
		});
		this.runtimeClientTransition = transition.then(
			() => undefined,
			() => undefined,
		);
		return transition;
	}

	prepare(ctx?: unknown): Promise<void> | undefined {
		if (this.activeProviders(ctx).length === 0) return undefined;
		return this.getClient(ctx).then(() => undefined);
	}

	async checkpointNotebook(): Promise<void> {
		const pending = this.runtimeClientPromise;
		if (!pending) return;
		const client = await pending;
		await client.checkpoint?.();
	}

	async vmBindingStatus(
		ctx: ExtensionContext,
	): Promise<{ content: string; reset: boolean }> {
		if (this.executionKind(ctx) !== "vm")
			throw new Error("VM binding status requires VM Code");
		const client = await this.getRuntimeClient(ctx, "vm");
		if (!client.bindingInventory)
			throw new Error("VM binding status unavailable");
		const inventory = await client.bindingInventory({
			cwd: ctx.cwd,
			extensionContext: ctx,
		});
		return {
			content: formatVmBindingInventory(
				inventory,
				inventory.kind === "bindings" &&
					inventory.warn &&
					this.heavySystemPromptOverwrite(ctx),
			),
			reset: inventory.kind === "reset",
		};
	}

	async controlNotebook(
		request: NotebookControlRequest,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<NotebookControlResult> {
		const kind = this.executionKind(context.extensionContext);
		if (kind !== "ts") {
			throw new Error("Notebook controls require TS Notebook");
		}
		const client = await this.getRuntimeClient(context.extensionContext, kind);
		if (!client.controlNotebook)
			throw new Error("Notebook lifecycle controls are unavailable");
		return client.controlNotebook(request, context, signal);
	}

	async shutdownHost(): Promise<void> {
		this.clearOpaqueResults();
		await this.runtimeClientTransition;
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
		while (this.runtimeClientPromise) {
			const pending = this.runtimeClientPromise;
			this.runtimeClientPromise = undefined;
			this.runtimeClientOptionsKey = undefined;
			try {
				await (await pending).shutdown();
			} catch {
				// Startup failure already reached the caller.
			}
		}
	}

	private collectProviderTools(ctx?: unknown): CodeModeToolDefinition[] {
		const tools = collectUniqueTools(this.activeProviders(ctx), ctx);
		const kind = this.executionKind(ctx);
		if (kind !== "ts") return tools;
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
					`Nested tool names ${previous.name} and ${tool.name} both translate to ${globalName}`,
				);
			}
			throw new Error(`Duplicate code-mode tool: ${tool.name}`);
		}
		byName.set(globalName, tool);
		unique.push(tool);
	}
	return unique;
}
