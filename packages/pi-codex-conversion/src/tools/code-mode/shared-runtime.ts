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
		return collectUniqueTools(this.activeProviders(ctx), ctx);
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
			const pending = ensureCodeModeHostBinary().then(
				(binary) => new CodeModeHostClient({ binary, tools: [] }),
			);
			this.clientPromise = pending;
			void pending.catch(() => {
				if (this.clientPromise === pending) this.clientPromise = undefined;
			});
		}
		return this.clientPromise;
	}

	async shutdownHost(): Promise<void> {
		const pending = this.clientPromise;
		this.clientPromise = undefined;
		if (!pending) return;
		try {
			await (await pending).shutdown();
		} catch {
			// Startup failure already reached the caller.
		}
	}
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
