import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CacheDiagnosticsMode } from "../adapter/activation/config.ts";
import type { CodexDiagnosticsSink } from "../providers/openai-codex/types.ts";

interface ActiveCodexDiagnostics {
	record: CodexDiagnosticsSink;
	shutdown(): Promise<void>;
}

export interface LazyCodexDiagnostics {
	configure(options: {
		mode: CacheDiagnosticsMode;
		active: boolean;
		ctx: ExtensionContext;
		announceLog?: boolean | undefined;
	}): Promise<void>;
	sink(): CodexDiagnosticsSink | undefined;
	shutdown(): Promise<void>;
}

export function createLazyCodexDiagnostics(): LazyCodexDiagnostics {
	let active: ActiveCodexDiagnostics | undefined;
	let activeKey: string | undefined;
	let generation = 0;
	const sink: CodexDiagnosticsSink = (event) => active?.record(event);

	const stopActive = async () => {
		const previous = active;
		active = undefined;
		activeKey = undefined;
		await previous?.shutdown();
	};

	return {
		async configure(options) {
			const key = `${options.mode}:${options.ctx.sessionManager.getSessionId()}`;
			if (active && activeKey === key && options.active) return;
			const currentGeneration = ++generation;
			const mode = options.mode;
			if (mode === "off" || !options.active) {
				await stopActive();
				return;
			}
			const module = await import("./runtime.ts");
			if (generation !== currentGeneration) return;
			await stopActive();
			if (generation !== currentGeneration) return;
			const next = await module.createCodexDiagnosticsRuntime({ ...options, mode });
			if (generation !== currentGeneration) {
				await next.shutdown();
				return;
			}
			active = next;
			activeKey = key;
		},
		sink() {
			return active ? sink : undefined;
		},
		async shutdown() {
			generation++;
			await stopActive();
		},
	};
}
