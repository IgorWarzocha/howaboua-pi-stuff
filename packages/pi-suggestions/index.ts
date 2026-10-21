import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readConfig, type SuggestionConfig } from "./src/config.js";
import { conversationSnapshot, isHumanTui } from "./src/context.js";
import {
	attachSuggestionEditor,
	type SuggestionEditorHandle,
} from "./src/editor.js";
import { Predictions } from "./src/prediction.js";
import { showSettings } from "./src/settings.js";

export default function suggestions(pi: ExtensionAPI): void {
	let config: SuggestionConfig = { enabled: false };
	let editor: SuggestionEditorHandle | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request: AbortController | undefined;
	let generation = 0;
	let prompts = 0;
	let reportedFailure = false;
	const predictions = new Predictions();

	function cancel(): void {
		generation++;
		clearTimeout(timer);
		timer = undefined;
		request?.abort();
		request = undefined;
		editor?.clear();
	}

	function reset(): void {
		cancel();
		predictions.reset();
	}

	function load(ctx: ExtensionContext): void {
		reset();
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
			if (!isHumanTui(pi, ctx)) {
				ctx.ui.notify(
					"Suggestions are available only in a human-controlled terminal session.",
					"info",
				);
				return;
			}
			cancel();
			await showSettings(ctx, (next) => {
				reset();
				config = next;
				reportedFailure = false;
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!isHumanTui(pi, ctx)) {
			reset();
			editor?.dispose();
			editor = undefined;
			return;
		}
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
		reset();
	});
	pi.on("session_before_fork", () => {
		reset();
	});
	pi.on("session_before_tree", () => {
		reset();
	});
	pi.on("session_before_compact", () => {
		cancel();
	});
	pi.on("session_compact", () => {
		reset();
	});
	pi.on("session_tree", () => {
		reset();
	});
	pi.on("model_select", () => {
		reset();
	});
	pi.on("ui_prompt_start", () => {
		prompts++;
		cancel();
	});
	pi.on("ui_prompt_end", () => {
		prompts = Math.max(0, prompts - 1);
	});
	pi.on("session_shutdown", () => {
		reset();
		editor?.dispose();
		editor = undefined;
	});

	pi.on("agent_settled", (event, ctx) => {
		cancel();
		if (!isHumanTui(pi, ctx)) {
			reset();
			return;
		}
		predictions.sync(conversationSnapshot(pi, ctx));
		if (event.aborted || !config.enabled || !config.model || !editor) return;
		const selection = config.model;
		const epoch = generation;
		const sessionId = ctx.sessionManager.getSessionId();
		const leaf = ctx.sessionManager.getLeafId();
		const eligible = () =>
			generation === epoch &&
			isHumanTui(pi, ctx) &&
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
				const context = conversationSnapshot(pi, ctx);
				predictions.sync(context);
				if (!context.ready) return;
				const result = await predictions.predict(
					ctx,
					selection,
					context,
					signal,
				);
				if (!eligible() || controller.signal.aborted) return;
				if (signal.aborted) throw new Error("Suggestion request timed out.");
				const current = conversationSnapshot(pi, ctx);
				predictions.sync(current);
				if (
					current.window !== context.window ||
					current.turns.length !== context.turns.length ||
					current.turns.some(
						(turn, index) => turn.key !== context.turns[index]?.key,
					)
				)
					return;
				reportedFailure = false;
				if (result) {
					result.commit();
					editor?.show(result.text);
				}
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
