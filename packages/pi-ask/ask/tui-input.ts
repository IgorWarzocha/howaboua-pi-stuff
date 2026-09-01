import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Editor } from "@earendil-works/pi-tui";
import type {
	AskPrompt,
	AskResponse,
	PromptChoice,
	PromptState,
} from "./contracts.js";
import { promptStatesToResponses } from "./state.js";

export type EditingKind = "other" | "comment";

export interface AskUiState {
	tab: number;
	focus: number;
	editing: EditingKind | null;
}

interface EditingInputOptions {
	advance: () => void;
	editor: Editor;
	keybindings: KeybindingsManager;
	refresh: () => void;
	saveEditing: (submittedText?: string) => void;
	state: AskUiState;
}

export function handleAskEditingInput(
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

export function handleAskPromptInput(
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

export function handleAskNavigationInput(
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
