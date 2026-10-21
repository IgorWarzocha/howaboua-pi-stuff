import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readConfig, type SuggestionConfig } from "./src/config.js";
import {
	attachSuggestionEditor,
	type SuggestionEditorHandle,
} from "./src/editor.js";
import { predict, predictionContext } from "./src/prediction.js";
import { showSettings } from "./src/settings.js";

export default function suggestions(pi: ExtensionAPI): void {
	let config: SuggestionConfig = { enabled: false };
	let editor: SuggestionEditorHandle | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request: AbortController | undefined;
	let generation = 0;
	let prompts = 0;
	let reportedFailure = false;

	function cancel(): void {
		generation++;
		clearTimeout(timer);
		timer = undefined;
		request?.abort();
		request = undefined;
		editor?.clear();
	}

	function load(ctx: ExtensionContext): void {
		cancel();
		try {
			config = readConfig();
			reportedFailure = false;
		} catch (error) {
			config = { enabled: false };
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	}

	pi.registerCommand("suggestions", {
		description: "Configure next-prompt suggestions",
		handler: async (_args, ctx) => {
			cancel();
			await showSettings(ctx, (next) => {
				cancel();
				config = next;
				reportedFailure = false;
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		load(ctx);
		// Install once. Other extensions may compose this factory on later starts.
		editor ??= attachSuggestionEditor(ctx, cancel);
	});
	pi.on("before_agent_start", () => {
		cancel();
	});
	pi.on("input", () => {
		cancel();
	});
	pi.on("session_before_switch", () => {
		cancel();
	});
	pi.on("session_before_fork", () => {
		cancel();
	});
	pi.on("session_before_tree", () => {
		cancel();
	});
	pi.on("session_before_compact", () => {
		cancel();
	});
	pi.on("session_compact", () => {
		cancel();
	});
	pi.on("session_tree", () => {
		cancel();
	});
	pi.on("model_select", () => {
		cancel();
	});
	pi.on("ui_prompt_start", () => {
		prompts++;
		cancel();
	});
	pi.on("ui_prompt_end", () => {
		prompts = Math.max(0, prompts - 1);
	});
	pi.on("session_shutdown", () => {
		cancel();
		editor?.dispose();
		editor = undefined;
	});

	pi.on("agent_settled", (event, ctx) => {
		cancel();
		if (
			event.aborted ||
			ctx.mode !== "tui" ||
			!config.enabled ||
			!config.model ||
			!editor
		)
			return;
		const selection = config.model;
		const epoch = generation;
		const sessionId = ctx.sessionManager.getSessionId();
		const leaf = ctx.sessionManager.getLeafId();
		const eligible = () =>
			generation === epoch &&
			config.enabled &&
			prompts === 0 &&
			ctx.isIdle() &&
			!ctx.hasPendingMessages() &&
			ctx.ui.getEditorText() === "" &&
			ctx.sessionManager.getSessionId() === sessionId &&
			ctx.sessionManager.getLeafId() === leaf;
		timer = setTimeout(() => {
			timer = undefined;
			void generate();
		}, 500);
		timer.unref();

		async function generate(): Promise<void> {
			if (!eligible()) return;
			const controller = new AbortController();
			request = controller;
			const signal = AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(15000),
			]);
			try {
				const context = predictionContext(ctx);
				if (!context) return;
				const text = await predict(ctx, selection, context, signal);
				if (!eligible() || controller.signal.aborted) return;
				if (signal.aborted) throw new Error("Suggestion request timed out.");
				reportedFailure = false;
				if (text) editor?.show(text);
			} catch {
				if (!eligible() || controller.signal.aborted || reportedFailure) return;
				reportedFailure = true;
				ctx.ui.notify(
					"Suggestions are unavailable. Chat still works; check the model and provider access in /suggestions, or switch suggestions off.",
					"warning",
				);
			} finally {
				if (request === controller) request = undefined;
			}
		}
	});
}
