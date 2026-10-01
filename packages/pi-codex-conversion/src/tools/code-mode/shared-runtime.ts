import type { ExtensionContext, ToolLoadout, ToolLoadoutChanges } from "@earendil-works/pi-coding-agent";
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

export interface OpaqueContextGuard {
	scope: string;
	owner: string;
	generation: number;
	valid(): Promise<boolean>;
}

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
	clearOpaqueResults?(): void;
}

export interface CodeModeToolProvider {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	prepareLoadout?(loadout: ToolLoadout): ToolLoadoutChanges | undefined;
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	providesRenderers?: boolean | undefined;
	richRendering?(): boolean;
	minimalOutput?(): boolean;
	executionKind?(ctx: unknown): CodeModeExecutionKind;
	notebookOptions?(ctx: unknown): NotebookRuntimeOptions;
	opaqueResultScope?(ctx: ExtensionContext): Promise<string>;
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
	private opaqueGeneration = 0;
	private readonly pendingDeliveries = new Map<string, { response: RuntimeResponse; owner: string; expires: number; bytes: number; delivered: boolean }>();
	private deliveryExpiryTimer: ReturnType<typeof setTimeout> | undefined;

	async opaqueContextGuard(ctx: ExtensionContext): Promise<OpaqueContextGuard> {
		const generation = this.opaqueGeneration;
		const baseOwner = this.opaqueOwner(ctx);
		const providers = this.activeProviders(ctx).filter(provider => provider.opaqueResultScope);
		const provider = providers[0];
		if (providers.length !== 1 || !provider?.opaqueResultScope)
			throw new Error("Remote context authentication is unavailable or conflicting");
		const resolver = provider.opaqueResultScope;
		const resolveScope = () => resolver.call(provider, ctx);
		const scope = await resolveScope();
		const unchanged = () => generation === this.opaqueGeneration && baseOwner === this.opaqueOwner(ctx);
		if (!unchanged()) throw new Error("Remote context changed during authentication; start a new exec cell");
		return { scope, generation, owner: JSON.stringify([baseOwner, scope]), valid: async () => {
			if (!unchanged()) return false;
			const latest = await resolveScope();
			return unchanged() && latest === scope;
		} };
	}

	assertOpaqueDeliveryCapacity(): void {
		this.expireDeliveries();
		const pending = [...this.pendingDeliveries.values()].filter(entry => !entry.delivered);
		if (pending.length >= 32 || pending.reduce((sum, entry) => sum + entry.bytes, 0) >= 32 * 1024 * 1024)
			throw new Error("Remote delivery capacity reached; call wait for pending cells before starting another exec");
	}

	deferOpaqueResponse(response: RuntimeResponse, guard?: OpaqueContextGuard): RuntimeResponse {
		if (!response.opaqueOutputs?.length) return response;
		if (!guard) throw new Error("Remote result authentication is unavailable");
		response = { ...response, opaqueScope: guard.scope };
		this.expireDeliveries();
		const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
		let held = [...this.pendingDeliveries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
		for (const [cellId, entry] of this.pendingDeliveries) {
			if (this.pendingDeliveries.size < 32 && held + bytes <= 32 * 1024 * 1024) break;
			if (!entry.delivered) continue;
			this.pendingDeliveries.delete(cellId);
			held -= entry.bytes;
		}
		if (this.pendingDeliveries.size >= 32 || held + bytes > 32 * 1024 * 1024)
			throw new Error("Remote operation executed but delivery capacity was exceeded; verify note state before repeating a write");
		this.pendingDeliveries.set(response.cellId, { response, owner: guard.owner, expires: Date.now() + 15 * 60_000, bytes, delivered: false });
		this.armDeliveryExpiry();
		return {
			kind: "yielded", cellId: response.cellId, contentItems: [],
			deliveryPending: response.kind !== "yielded",
		};
	}

	async takeOpaqueDelivery(cellId: string, ctx: ExtensionContext): Promise<RuntimeResponse | undefined> {
		const entry = this.pendingDeliveries.get(cellId);
		if (!entry) return undefined;
		const guard = await this.opaqueContextGuard(ctx);
		if (this.pendingDeliveries.get(cellId) !== entry || entry.expires <= Date.now() || entry.owner !== guard.owner) {
			if (this.pendingDeliveries.get(cellId) === entry) this.pendingDeliveries.delete(cellId);
			throw new Error("Remote result expired or context changed after execution; verify note state before repeating a write");
		}
		if (!entry.delivered) return entry.response;
		// A cached result is retrieval, not a new write or rollover authorization.
		const { contextNotesSaved: _saved, contextNotesSource: _source, terminate: _terminate, ...replay } = entry.response;
		return replay;
	}

	acknowledgeOpaqueDelivery(cellId: string): void {
		const entry = this.pendingDeliveries.get(cellId);
		if (!entry) return;
		entry.delivered = true;
		if (entry.response.kind === "yielded") this.pendingDeliveries.delete(cellId);
	}

	clearOpaqueResults(): void {
		this.opaqueGeneration++;
		this.pendingDeliveries.clear();
		if (this.deliveryExpiryTimer) clearTimeout(this.deliveryExpiryTimer);
		this.deliveryExpiryTimer = undefined;
		for (const pending of [this.clientPromise, this.notebookClientPromise])
			void pending?.then(client => client.clearOpaqueResults?.(), () => undefined);
	}

	private opaqueOwner(ctx: ExtensionContext): string {
		return JSON.stringify([ctx.sessionManager.getSessionId(), ctx.model?.api, ctx.model?.provider,
			ctx.model?.id, ctx.model?.baseUrl, this.executionKind(ctx),
			this.collectTools(ctx).some(tool => "invoke" in tool && tool.opaqueResult)]);
	}

	private expireDeliveries(): void {
		for (const [cellId, entry] of this.pendingDeliveries)
			if (entry.expires <= Date.now()) this.pendingDeliveries.delete(cellId);
	}

	private armDeliveryExpiry(): void {
		if (this.deliveryExpiryTimer) clearTimeout(this.deliveryExpiryTimer);
		const expires = Math.min(...[...this.pendingDeliveries.values()].map(entry => entry.expires));
		if (!Number.isFinite(expires)) return;
		this.deliveryExpiryTimer = setTimeout(() => {
			this.deliveryExpiryTimer = undefined;
			this.expireDeliveries();
			this.armDeliveryExpiry();
		}, Math.max(1, expires - Date.now()));
		this.deliveryExpiryTimer.unref();
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
		const changes = [...this.providers.values()].map((provider) => provider.prepareLoadout?.(loadout));
		return {
			hiddenDeclarations: changes.flatMap((change) => change?.hiddenDeclarations ?? []),
			descriptions: Object.assign({}, ...changes.map((change) => change?.descriptions)),
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
		const liveProgrammaticTools = this.collectProviderTools(ctx)
			.filter((tool) => !isCustomTool(tool));
		return [...liveProgrammaticTools, ...this.customPromptToolsSnapshot];
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

	useMinimalOutput(): boolean {
		return [...this.providers.values()].find((provider) => provider.minimalOutput)
			?.minimalOutput?.() ?? false;
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
		this.clearOpaqueResults();
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
