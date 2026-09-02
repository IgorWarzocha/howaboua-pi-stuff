import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, truncateToWidth } from "@earendil-works/pi-tui";
import type { AskPrompt, AskResponse } from "./contracts.js";
import {
	clearCustomSelection,
	createPromptState,
	pickChoiceSelection,
	promptStateResponded,
	saveComment,
	saveCustomSelection,
} from "./state.js";
import {
	type AskUiState,
	type EditingKind,
	handleAskEditingInput,
	handleAskNavigationInput,
	handleAskPromptInput,
} from "./tui-input.js";
import {
	renderAskPrompt,
	renderAskReview,
	renderAskTabs,
} from "./tui-render.js";

type AddLine = (line?: string) => void;

export async function askInTui(
	ctx: ExtensionContext,
	prompts: AskPrompt[],
	{ handoff = false, signal }: { handoff?: boolean; signal?: AbortSignal } = {},
): Promise<AskResponse[] | null> {
	if (!ctx.hasUI || signal?.aborted) return null;
	return await ctx.ui.custom<AskResponse[] | null>((tui, theme, kb, done) => {
		let settled = false;
		const finish = (result: AskResponse[] | null) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			done(result);
		};
		const abort = () => finish(null);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) queueMicrotask(abort);
		const state: AskUiState = { tab: 0, focus: 0, editing: null };
		let cached: string[] | undefined;
		// Keep response lifecycle in one object per prompt. Parallel arrays made tab/default
		// transitions easy to desynchronise as this tool grows.
		const promptStates = prompts.map(createPromptState);
		const editor = new Editor(tui, {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("muted", text),
			},
		});

		const reviewTab = () => prompts.length;
		const current = () => prompts[state.tab];
		const currentPromptState = () => promptStates[state.tab];
		const choices = () => current()?.choices ?? [];
		const isReview = () => state.tab === reviewTab();
		const count = () => choices().length + 2;
		const refresh = () => {
			cached = undefined;
			tui.requestRender();
		};
		const responded = (index: number) =>
			promptStateResponded(promptStates[index]);
		const setTab = (next: number) => {
			state.tab = Math.max(0, Math.min(reviewTab(), next));
			state.focus = 0;
			state.editing = null;
			editor.setText(promptStates[state.tab]?.customText ?? "");
			refresh();
		};
		const saveCustom = (submittedText = editor.getText()) => {
			const prompt = current();
			const promptState = currentPromptState();
			if (!prompt || !promptState) return;
			saveCustomSelection(prompt, promptState, submittedText);
		};
		const saveEditing = (submittedText = editor.getText()) => {
			const promptState = currentPromptState();
			if (!promptState) return;
			if (state.editing === "comment") saveComment(promptState, submittedText);
			else saveCustom(submittedText);
		};
		const startEditing = (kind: EditingKind) => {
			const promptState = currentPromptState();
			if (!promptState) return;
			state.editing = kind;
			editor.setText(
				kind === "comment" ? promptState.comment : promptState.customText,
			);
			refresh();
		};
		const selectOther = () => {
			const prompt = current();
			const promptState = currentPromptState();
			if (!prompt || !promptState) return;
			if (prompt.multiple && promptState.customEnabled) {
				clearCustomSelection(promptState);
				refresh();
				return;
			}
			startEditing("other");
		};
		const advance = () => setTab(state.tab + 1);
		const advanceWithDefault = () => {
			if (!isReview() && !responded(state.tab)) saveCustom("");
			advance();
		};
		editor.onSubmit = (value) => {
			saveEditing(value);
			state.editing = null;
			refresh();
		};
		const pick = (index: number) => {
			const choice = choices()[index];
			const prompt = current();
			const promptState = currentPromptState();
			if (!choice || !promptState) return;
			pickChoiceSelection(prompt, promptState, choice);
			refresh();
		};
		const handleInput = (data: string) => {
			if (state.editing) {
				handleAskEditingInput(data, {
					advance,
					editor,
					keybindings: kb,
					refresh,
					saveEditing,
					state,
				});
				return;
			}
			if (
				handleAskNavigationInput(data, {
					done: finish,
					isReview,
					keybindings: kb,
					promptStates,
					prompts,
					setTab,
					state,
				})
			) {
				return;
			}
			handleAskPromptInput(data, {
				advanceWithDefault,
				count,
				choices,
				keybindings: kb,
				pick,
				refresh,
				selectOther,
				startEditingComment: () => startEditing("comment"),
				state,
			});
		};
		const render = (width: number) => {
			if (cached) return cached;
			const lines: string[] = [];
			const add: AddLine = (line = "") =>
				lines.push(truncateToWidth(line, width));
			add(theme.fg("accent", "─".repeat(width)));
			add(
				renderAskTabs({ handoff, prompts, responded, tab: state.tab, theme }),
			);
			add();
			if (isReview()) {
				renderAskReview({
					add,
					handoff,
					keybindings: kb,
					promptStates,
					prompts,
					theme,
					width,
				});
			} else {
				const prompt = current();
				if (prompt) {
					renderAskPrompt({
						add,
						editor,
						handoff,
						isEditing: state.editing,
						keybindings: kb,
						choices: choices(),
						prompt,
						promptState: currentPromptState(),
						state,
						theme,
						width,
					});
				}
			}
			add(theme.fg("accent", "─".repeat(width)));
			cached = lines;
			return lines;
		};
		return {
			render,
			handleInput,
			dispose: () => signal?.removeEventListener("abort", abort),
			invalidate: () => {
				cached = undefined;
			},
		};
	});
}
