import {
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	Editor,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { OTHER_OPTION_LABEL } from "./constants.js";
import type {
	AskPrompt,
	AskResponse,
	PromptChoice,
	PromptState,
} from "./contracts.js";
import {
	clearCustomSelection,
	createPromptState,
	pickChoiceSelection,
	promptStateResponded,
	promptStatesToResponses,
	saveComment,
	saveCustomSelection,
} from "./state.js";

type AskTheme = ExtensionContext["ui"]["theme"];
type AskKeybinding = Parameters<KeybindingsManager["getKeys"]>[0];
type AddLine = (line?: string) => void;
type EditingKind = "other" | "comment";

interface AskUiState {
	tab: number;
	focus: number;
	editing: EditingKind | null;
}

interface RenderTabsOptions {
	handoff: boolean;
	prompts: AskPrompt[];
	responded: (index: number) => boolean;
	tab: number;
	theme: AskTheme;
}

interface RenderReviewOptions {
	add: AddLine;
	handoff: boolean;
	keybindings: KeybindingsManager;
	promptStates: PromptState[];
	prompts: AskPrompt[];
	theme: AskTheme;
	width: number;
}

interface RenderChoiceOptions {
	add: AddLine;
	checked: boolean | undefined;
	choice: PromptChoice;
	selected: boolean;
	theme: AskTheme;
	width: number;
}

interface RenderPromptOptions {
	add: AddLine;
	editor: Editor;
	handoff: boolean;
	isEditing: EditingKind | null;
	keybindings: KeybindingsManager;
	choices: PromptChoice[];
	prompt: AskPrompt;
	promptState: PromptState | undefined;
	state: AskUiState;
	theme: AskTheme;
	width: number;
}

function addWrapped(
	add: AddLine,
	text: string,
	width: number,
	indent = "",
): void {
	for (const line of wrapTextWithAnsi(
		text,
		Math.max(1, width - indent.length),
	)) {
		add(`${indent}${line}`);
	}
}

function renderKeyHint(
	theme: AskTheme,
	keybindings: KeybindingsManager,
	action: AskKeybinding,
	description: string,
): string {
	return (
		theme.fg("dim", keybindings.getKeys(action).join("/")) +
		theme.fg("muted", ` ${description}`)
	);
}

function renderAskTabs({
	handoff,
	prompts,
	responded,
	tab,
	theme,
}: RenderTabsOptions): string {
	return ` ${Array.from({ length: prompts.length + 1 }, (_, index) => {
		const active = index === tab;
		const label =
			index === prompts.length
				? handoff
					? "Resume"
					: "Review"
				: `${responded(index) ? "■" : "□"} ${index + 1}`;
		return active
			? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
			: theme.fg("muted", ` ${label} `);
	}).join(" ")}`;
}

function renderAskReview({
	add,
	handoff,
	keybindings,
	promptStates,
	prompts,
	theme,
	width,
}: RenderReviewOptions): void {
	add(theme.fg("accent", handoff ? " Resume agent" : " Review"));
	add();
	prompts.forEach((prompt, index) => {
		const promptState = promptStates[index];
		const selections = promptState?.selections ?? [];
		addWrapped(
			add,
			theme.fg("muted", `${index + 1}. ${prompt.title}`),
			width,
			" ",
		);
		addWrapped(
			add,
			theme.fg("text", selections.join(", ") || "No selection"),
			width,
			"    ",
		);
		if (promptState?.comment.trim()) {
			addWrapped(
				add,
				theme.fg("muted", `Comment: ${promptState.comment.trim()}`),
				width,
				"    ",
			);
		}
	});
	add();
	addWrapped(
		add,
		" " +
			renderKeyHint(
				theme,
				keybindings,
				"tui.select.confirm",
				handoff ? "return control" : "submit",
			) +
			" • " +
			renderKeyHint(
				theme,
				keybindings,
				"tui.editor.cursorLeft",
				"previous prompt",
			) +
			" • " +
			renderKeyHint(
				theme,
				keybindings,
				"tui.editor.cursorRight",
				"next prompt",
			) +
			" • " +
			renderKeyHint(theme, keybindings, "tui.select.cancel", "dismiss"),
		width,
	);
}

function renderAskChoice({
	add,
	checked,
	choice,
	selected,
	theme,
	width,
}: RenderChoiceOptions): void {
	add(
		`${selected ? theme.fg("accent", "> ") : "  "}${checked ? theme.fg("success", "✓ ") : "  "}${theme.fg(selected ? "accent" : "text", choice.label)}`,
	);
	if (choice.description) {
		addWrapped(add, theme.fg("muted", choice.description), width, "    ");
	}
}

function renderAskPrompt({
	add,
	editor,
	handoff,
	isEditing,
	keybindings,
	choices,
	prompt,
	promptState,
	state,
	theme,
	width,
}: RenderPromptOptions): void {
	if (handoff) {
		add(theme.fg("accent", " Human action needed"));
		add();
	}
	addWrapped(add, theme.fg("text", prompt.title), width, " ");
	add(
		theme.fg(
			"muted",
			` ${prompt.multiple ? "Choose any that apply" : "Choose one"}`,
		),
	);
	if (prompt.body) {
		add();
		addWrapped(add, theme.fg("muted", prompt.body), width, "   ");
	}
	add();
	choices.forEach((choice, index) => {
		renderAskChoice({
			add,
			checked: promptState?.selections.includes(choice.label),
			choice,
			selected: state.focus === index,
			theme,
			width,
		});
	});
	const selectedOther = state.focus === choices.length;
	add(
		`${selectedOther ? theme.fg("accent", "> ") : "  "}${promptState?.customEnabled ? theme.fg("success", "✓ ") : "  "}${theme.fg(selectedOther ? "accent" : "muted", OTHER_OPTION_LABEL)}${promptState?.customText.trim() ? theme.fg("text", `: ${promptState.customText.trim()}`) : ""}`,
	);
	if (isEditing === "other") {
		add();
		for (const line of editor.render(width - 2)) add(` ${line}`);
	}
	const selectedComment = state.focus === choices.length + 1;
	add();
	add(
		`${selectedComment ? theme.fg("accent", "> ") : "  "}${theme.fg(selectedComment ? "accent" : "text", "Comment (optional)")}`,
	);
	if (promptState?.comment.trim()) {
		addWrapped(
			add,
			theme.fg("muted", promptState.comment.trim()),
			width,
			"    ",
		);
	}
	if (isEditing === "comment") {
		add();
		for (const line of editor.render(width - 2)) add(` ${line}`);
	}
	add();
	if (isEditing) {
		addWrapped(
			add,
			" " +
				renderKeyHint(theme, keybindings, "tui.input.submit", "save") +
				" • " +
				renderKeyHint(theme, keybindings, "tui.input.tab", "next/default") +
				" • " +
				renderKeyHint(theme, keybindings, "tui.select.cancel", "cancel edit"),
			width,
		);
		return;
	}
	addWrapped(
		add,
		" " +
			renderKeyHint(theme, keybindings, "tui.select.up", "up") +
			" • " +
			renderKeyHint(theme, keybindings, "tui.select.down", "down") +
			" • " +
			renderKeyHint(theme, keybindings, "tui.select.confirm", "choose/type") +
			" • " +
			renderKeyHint(theme, keybindings, "tui.input.tab", "next/default") +
			" • blank Other/rephrase = follow-up • " +
			renderKeyHint(theme, keybindings, "tui.select.cancel", "close"),
		width,
	);
}

interface EditingInputOptions {
	advance: () => void;
	editor: Editor;
	keybindings: KeybindingsManager;
	refresh: () => void;
	saveEditing: (submittedText?: string) => void;
	state: AskUiState;
}

function handleAskEditingInput(
	data: string,
	{
		advance,
		editor,
		keybindings,
		refresh,
		saveEditing,
		state,
	}: EditingInputOptions,
): void {
	if (keybindings.matches(data, "tui.input.tab")) {
		saveEditing(editor.getText());
		state.editing = null;
		advance();
		return;
	}
	if (keybindings.matches(data, "tui.select.cancel")) {
		state.editing = null;
		refresh();
		return;
	}
	editor.handleInput(data);
	refresh();
}

interface PromptInputOptions {
	advanceWithDefault: () => void;
	choices: () => PromptChoice[];
	count: () => number;
	keybindings: KeybindingsManager;
	pick: (index: number) => void;
	refresh: () => void;
	selectOther: () => void;
	startEditingComment: () => void;
	state: AskUiState;
}

function handleAskPromptInput(
	data: string,
	{
		advanceWithDefault,
		choices,
		count,
		keybindings,
		pick,
		refresh,
		selectOther,
		startEditingComment,
		state,
	}: PromptInputOptions,
): void {
	if (keybindings.matches(data, "tui.select.up")) {
		state.focus = Math.max(0, state.focus - 1);
		refresh();
		return;
	}
	if (keybindings.matches(data, "tui.select.down")) {
		state.focus = Math.min(count() - 1, state.focus + 1);
		refresh();
		return;
	}
	if (keybindings.matches(data, "tui.input.tab")) {
		advanceWithDefault();
		return;
	}
	if (!keybindings.matches(data, "tui.select.confirm")) return;
	if (state.focus === choices().length) {
		selectOther();
		return;
	}
	if (state.focus === choices().length + 1) {
		startEditingComment();
		return;
	}
	pick(state.focus);
}

interface NavigationInputOptions {
	done: (responses: AskResponse[] | null) => void;
	isReview: () => boolean;
	keybindings: KeybindingsManager;
	promptStates: PromptState[];
	prompts: AskPrompt[];
	setTab: (next: number) => void;
	state: AskUiState;
}

function handleAskNavigationInput(
	data: string,
	{
		done,
		isReview,
		keybindings,
		promptStates,
		prompts,
		setTab,
		state,
	}: NavigationInputOptions,
): boolean {
	if (keybindings.matches(data, "tui.select.cancel")) {
		done(null);
		return true;
	}
	if (keybindings.matches(data, "tui.editor.cursorLeft")) {
		setTab(state.tab - 1);
		return true;
	}
	if (keybindings.matches(data, "tui.editor.cursorRight")) {
		setTab(state.tab + 1);
		return true;
	}
	if (!isReview()) return false;
	if (keybindings.matches(data, "tui.select.confirm")) {
		done(promptStatesToResponses(prompts, promptStates));
	}
	return true;
}

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
