import {
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { Editor, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { OTHER_OPTION_LABEL } from "./constants.js";
import type { AskPrompt, PromptChoice, PromptState } from "./contracts.js";
import type { AskUiState, EditingKind } from "./tui-input.js";

type AskTheme = ExtensionContext["ui"]["theme"];
type AskKeybinding = Parameters<KeybindingsManager["getKeys"]>[0];
type AddLine = (line?: string) => void;
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
export function renderAskTabs({
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

export function renderAskReview({
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

export function renderAskPrompt({
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
