import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { WebSearchToolOptions } from "./contract.js";
import {
	executeCodexWebSearch,
	type WebRunExecutionResult,
} from "./execute.js";

export const CODEX_WEB_RUN_SERVICE = "@howaboua/pi-codex-web-run.service/v1";

/** Discover synchronously per use; discovery does not check auth or run a search. */
export interface CodexWebRunServiceRequest {
	use(service: CodexWebRunService): void;
}

export interface CodexWebRunService {
	readonly protocol: 1;
	/** Explicit web_run arguments; results are returned only to the caller. */
	run(
		ctx: ExtensionContext,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<WebRunExecutionResult>;
}

export function registerCodexWebRunService(
	pi: ExtensionAPI,
	options: WebSearchToolOptions,
): void {
	const lifetime = new AbortController();
	const service: CodexWebRunService = {
		protocol: 1,
		async run(ctx, params, signal) {
			const operation = signal
				? AbortSignal.any([lifetime.signal, signal])
				: lifetime.signal;
			operation.throwIfAborted();
			const result = await executeCodexWebSearch(
				params,
				ctx,
				operation,
				options,
			);
			operation.throwIfAborted();
			return result;
		},
	};
	const off = pi.events.on(CODEX_WEB_RUN_SERVICE, (request) => {
		if (
			request &&
			typeof request === "object" &&
			"use" in request &&
			typeof request.use === "function"
		)
			request.use(service);
	});
	pi.on("session_shutdown", () => {
		off();
		lifetime.abort(
			new Error("Web search session ended. Retry in the current session."),
		);
	});
}
