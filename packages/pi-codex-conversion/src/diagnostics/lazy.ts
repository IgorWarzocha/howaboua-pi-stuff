import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CacheDiagnosticsMode } from "../adapter/activation/config.ts";
import type { CodexDiagnosticsSink } from "../providers/openai-codex/types.ts";

interface ActiveCodexDiagnostics {
	key: string;
	runtime: {
		record: CodexDiagnosticsSink;
		shutdown(): Promise<void>;
	};
	sink: CodexDiagnosticsSink;
}

export interface LazyCodexDiagnostics {
	configure(options: {
		mode: CacheDiagnosticsMode;
		active: boolean;
		ctx: ExtensionContext;
		agentDir: string;
		announceLog?: boolean | undefined;
	}): Promise<void>;
	sink(): CodexDiagnosticsSink | undefined;
	shutdown(): Promise<void>;
}

export function createLazyCodexDiagnostics(): LazyCodexDiagnostics {
	let active: ActiveCodexDiagnostics | undefined;
	let stopInFlight: Promise<void> | undefined;
	let generation = 0;

	const stopActive = (): Promise<void> => {
		const previous = active;
		active = undefined;
		if (!previous) return stopInFlight ?? Promise.resolve();
		const current = (stopInFlight ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => previous.runtime.shutdown());
		stopInFlight = current;
		void current.finally(() => {
			if (stopInFlight === current) stopInFlight = undefined;
		}).catch(() => undefined);
		return current;
	};
	const stopForReconfigure = async (ctx: ExtensionContext) => {
		try {
			await stopActive();
		} catch (error) {
			try {
				ctx.ui.notify(
					`Could not close the previous Codex cache log: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			} catch {
				// Diagnostics lifecycle failures must not block session replacement.
			}
		}
	};

	return {
		async configure(options) {
			const model = options.ctx.model;
			const key = JSON.stringify([
				options.mode,
				options.ctx.sessionManager.getSessionId(),
				model?.provider,
				model?.id,
				model?.api,
				model?.baseUrl,
			]);
			if (active?.key === key && options.active) return;
			const currentGeneration = ++generation;
			const mode = options.mode;
			if (mode === "off" || !options.active) {
				await stopForReconfigure(options.ctx);
				return;
			}
			const module = await import("./runtime.ts");
			if (generation !== currentGeneration) return;
			await stopForReconfigure(options.ctx);
			if (generation !== currentGeneration) return;
			const next = await module.createCodexDiagnosticsRuntime({ ...options, mode });
			if (generation !== currentGeneration) {
				await next.shutdown();
				return;
			}
			let sinkFailed = false;
			const sink: CodexDiagnosticsSink = (event) => {
				if (sinkFailed || generation !== currentGeneration || active?.runtime !== next) return;
				try {
					next.record(event);
				} catch (error) {
					sinkFailed = true;
					try {
						options.ctx.ui.notify(
							`Codex cache diagnostics stopped: ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						);
					} catch {
						// Diagnostics must never affect provider execution.
					}
				}
			};
			active = { key, runtime: next, sink };
		},
		sink() {
			return active?.sink;
		},
		async shutdown() {
			generation++;
			await stopActive();
		},
	};
}
