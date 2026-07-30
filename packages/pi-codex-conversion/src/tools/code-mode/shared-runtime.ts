import { ensureCodeModeHostBinary } from "./binary.js";
import { CodeModeHostClient } from "./host-client.js";
import type { CodeModeToolDefinition } from "./types.js";

export interface CodeModeToolProvider {
	getTools(ctx?: unknown): CodeModeToolDefinition[];
	documentationPath?: string | undefined;
	isActive?(ctx: unknown): boolean;
	providesRenderers?: boolean | undefined;
	richRendering?(): boolean;
}

export class SharedCodeModeRuntime {
	readonly providers = new Map<object, CodeModeToolProvider>();
	private clientPromise: Promise<CodeModeHostClient> | undefined;
	private clientStartupAbort: AbortController | undefined;
	private promptToolsSnapshot: CodeModeToolDefinition[] | undefined;

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
		const tools = collectUniqueTools(this.activeProviders(ctx), ctx);
		if (!this.promptToolsSnapshot) return tools;
		const customPromptState = new Map(
			this.promptToolsSnapshot
				.filter(isCustomTool)
				.map((tool) => [tool.name, tool.deferLoading]),
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

	refreshPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		this.promptToolsSnapshot = collectUniqueTools(this.activeProviders(ctx), ctx);
		return this.promptToolsSnapshot;
	}

	collectPromptTools(ctx?: unknown): CodeModeToolDefinition[] {
		return this.promptToolsSnapshot ?? this.refreshPromptTools(ctx);
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

	async getClient(): Promise<CodeModeHostClient> {
		if (!this.clientPromise) {
			const startupAbort = new AbortController();
			const pending = ensureCodeModeHostBinary(startupAbort.signal).then(
				(binary) => new CodeModeHostClient({ binary, tools: [] }),
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

	prepare(ctx?: unknown): Promise<void> | undefined {
		if (this.activeProviders(ctx).length === 0) return undefined;
		return this.getClient().then(() => undefined);
	}

	async shutdownHost(): Promise<void> {
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
	}
}

function isCustomTool(tool: CodeModeToolDefinition): boolean {
	return "command" in tool;
}

function collectUniqueTools(
	providers: CodeModeToolProvider[],
	ctx?: unknown,
): CodeModeToolDefinition[] {
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
}
