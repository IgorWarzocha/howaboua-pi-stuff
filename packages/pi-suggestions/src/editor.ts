import {
	CustomEditor,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	type EditorComponent,
	type Focusable,
	isKeyRelease,
	matchesKey,
	renderFakeCursor,
	sliceByColumn,
	stripTerminalSequences,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

type DelegatedEditor = EditorComponent & Partial<CustomEditor>;
type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface SuggestionState {
	active: boolean;
	prediction: string | undefined;
	onInput: () => void;
	requestRender: () => void;
}

/** Owns only ghost rendering and input interception; the inner editor owns the draft. */
class SuggestionEditor implements EditorComponent, Focusable {
	private displayed: string | undefined;
	private readonly inner: DelegatedEditor;
	private readonly state: SuggestionState;

	declare onSubmit?: NonNullable<EditorComponent["onSubmit"]>;
	declare onChange?: NonNullable<EditorComponent["onChange"]>;
	declare borderColor?: NonNullable<EditorComponent["borderColor"]>;
	declare wantsKeyRelease?: boolean;
	declare disableSubmit?: boolean;
	declare actionHandlers?: CustomEditor["actionHandlers"];
	declare onEscape?: NonNullable<CustomEditor["onEscape"]>;
	declare onCtrlD?: NonNullable<CustomEditor["onCtrlD"]>;
	declare onPasteImage?: NonNullable<CustomEditor["onPasteImage"]>;
	declare onExtensionShortcut?: NonNullable<
		CustomEditor["onExtensionShortcut"]
	>;
	declare readonly embedWorkingStatus?: boolean;

	readonly addToHistory?: NonNullable<EditorComponent["addToHistory"]>;
	readonly setAutocompleteProvider?: NonNullable<
		EditorComponent["setAutocompleteProvider"]
	>;
	readonly setPaddingX?: NonNullable<EditorComponent["setPaddingX"]>;
	readonly setAutocompleteMaxVisible?: NonNullable<
		EditorComponent["setAutocompleteMaxVisible"]
	>;
	readonly getPaddingX?: CustomEditor["getPaddingX"];
	readonly getAutocompleteMaxVisible?: CustomEditor["getAutocompleteMaxVisible"];
	readonly getLines?: CustomEditor["getLines"];
	readonly getCursor?: CustomEditor["getCursor"];
	readonly isShowingAutocomplete?: CustomEditor["isShowingAutocomplete"];
	readonly onAction?: CustomEditor["onAction"];
	readonly setWorkingStatusIndicator?: CustomEditor["setWorkingStatusIndicator"];
	readonly insertTextAtCursor?: NonNullable<
		EditorComponent["insertTextAtCursor"]
	>;

	constructor(inner: DelegatedEditor, state: SuggestionState) {
		this.inner = inner;
		this.state = state;
		// Accessors belong to this wrapper, never to the inner instance. Pi wires
		// callbacks after the factory returns; later observers must see that wiring.
		for (const key of [
			"onSubmit",
			"onChange",
			"borderColor",
			"wantsKeyRelease",
			"disableSubmit",
			"actionHandlers",
			"onEscape",
			"onCtrlD",
			"onPasteImage",
			"onExtensionShortcut",
			"embedWorkingStatus",
		] as const) {
			Object.defineProperty(this, key, {
				configurable: true,
				get: () => inner[key],
				set: (value: unknown) => {
					if (value === undefined) Reflect.deleteProperty(inner, key);
					else Reflect.set(inner, key, value);
				},
			});
		}
		if (inner.addToHistory) this.addToHistory = inner.addToHistory.bind(inner);
		if (inner.setAutocompleteProvider)
			this.setAutocompleteProvider = inner.setAutocompleteProvider.bind(inner);
		if (inner.setPaddingX) this.setPaddingX = inner.setPaddingX.bind(inner);
		if (inner.setAutocompleteMaxVisible)
			this.setAutocompleteMaxVisible =
				inner.setAutocompleteMaxVisible.bind(inner);
		if (inner.getPaddingX) this.getPaddingX = inner.getPaddingX.bind(inner);
		if (inner.getAutocompleteMaxVisible)
			this.getAutocompleteMaxVisible =
				inner.getAutocompleteMaxVisible.bind(inner);
		if (inner.getLines) this.getLines = inner.getLines.bind(inner);
		if (inner.getCursor) this.getCursor = inner.getCursor.bind(inner);
		if (inner.isShowingAutocomplete)
			this.isShowingAutocomplete = inner.isShowingAutocomplete.bind(inner);
		if (inner.onAction) this.onAction = inner.onAction.bind(inner);
		if (inner.setWorkingStatusIndicator)
			this.setWorkingStatusIndicator =
				inner.setWorkingStatusIndicator.bind(inner);
		if (inner.insertTextAtCursor) {
			this.insertTextAtCursor = (text) => {
				this.clear();
				inner.insertTextAtCursor?.(text);
			};
		}
	}

	get focused() {
		return this.inner.focused ?? false;
	}
	set focused(value) {
		if ("focused" in this.inner) this.inner.focused = value;
		this.displayed = undefined;
	}

	getText(): string {
		return this.inner.getText();
	}
	getExpandedText(): string {
		return this.inner.getExpandedText?.() ?? this.inner.getText();
	}
	setText(text: string): void {
		this.clear();
		this.inner.setText(text);
	}
	invalidate(): void {
		this.displayed = undefined;
		this.inner.invalidate();
	}
	clear(): void {
		this.state.prediction = undefined;
		this.displayed = undefined;
		this.state.requestRender();
	}

	private canShow(): boolean {
		return (
			this.state.active &&
			this.focused &&
			this.inner.getText() === "" &&
			!this.inner.isShowingAutocomplete?.()
		);
	}

	render(width: number): string[] {
		this.displayed = undefined;
		const lines = this.inner.render(width);
		const prediction = this.state.prediction;
		if (!prediction || !this.canShow()) return lines;
		// Unknown layouts and menus are left untouched. A marker alone is not
		// enough: require the standard empty row between two editor borders.
		if (lines.length !== 3) return lines;
		const row = lines[1];
		if (row === undefined) return lines;
		const marker = row.indexOf(CURSOR_MARKER);
		if (marker < 0 || lines.join("").split(CURSOR_MARKER).length !== 2)
			return lines;
		const before = row.slice(0, marker);
		const after = row.slice(marker + CURSOR_MARKER.length);
		const cursor = renderFakeCursor(" ");
		if (
			!after.startsWith(cursor) ||
			!/^[ ]*$/.test(stripTerminalSequences(before)) ||
			!/^[ ]*$/.test(stripTerminalSequences(after)) ||
			visibleWidth(row) !== width
		)
			return lines;
		const column = visibleWidth(before);
		const available = width - column * 2;
		if (available < 2) return lines;
		// The width helper emits ANSI resets on truncation, even for plain input.
		// Strip those before choosing the fake cursor grapheme and applying dim.
		const ghost = stripTerminalSequences(
			truncateToWidth(prediction, available, "…"),
		);
		if (ghost === "…" && prediction !== ghost) return lines;
		const first = graphemes.segment(ghost)[Symbol.iterator]().next()
			.value?.segment;
		if (!first || visibleWidth(ghost) === 0) return lines;
		const tail = sliceByColumn(
			after.slice(cursor.length),
			visibleWidth(ghost) - 1,
			width - column - visibleWidth(ghost),
		);
		const result = [...lines];
		result[1] =
			before +
			CURSOR_MARKER +
			"\x1b[2m" +
			renderFakeCursor(first) +
			ghost.slice(first.length) +
			"\x1b[22m" +
			tail;
		if (visibleWidth(result[1]) !== width) return lines;
		this.displayed = prediction;
		return result;
	}

	handleInput(data: string): void {
		if (!this.state.active || isKeyRelease(data)) {
			this.inner.handleInput(data);
			return;
		}
		const prediction = this.displayed;
		const visible =
			prediction !== undefined &&
			prediction === this.state.prediction &&
			this.canShow();
		const accept = visible && matchesKey(data, "right");
		const dismiss = visible && matchesKey(data, "escape");
		this.clear();
		this.state.onInput();
		if (accept) {
			this.inner.setText(prediction);
			return;
		}
		if (!dismiss) this.inner.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent) {
		if (this.state.active && event.type !== "move") {
			this.clear();
			this.state.onInput();
		}
		return this.inner.handleMouse?.(event);
	}
}

export interface SuggestionEditorHandle {
	show(text: string): void;
	clear(): void;
	dispose(): void;
}

export function attachSuggestionEditor(
	ctx: ExtensionContext,
	onInput: () => void,
): SuggestionEditorHandle {
	const previous = ctx.ui.getEditorComponent();
	const state: SuggestionState = {
		active: true,
		prediction: undefined,
		onInput,
		requestRender: () => {},
	};
	let editor: SuggestionEditor | undefined;
	const factory: EditorFactory = (tui, theme, keybindings) => {
		state.requestRender = () => tui.requestRender();
		const inner =
			previous?.(tui, theme, keybindings) ??
			new CustomEditor(tui, theme, keybindings, { embedWorkingStatus: true });
		if (!state.active) return inner;
		editor = new SuggestionEditor(inner, state);
		return editor;
	};
	ctx.ui.setEditorComponent(factory);
	return {
		show(text) {
			if (!state.active) return;
			editor?.clear();
			// Reject terminal controls and multiline drafts, including C1 controls.
			if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)) return;
			state.prediction = text.trim() || undefined;
			state.requestRender();
		},
		clear() {
			editor?.clear();
		},
		dispose() {
			if (!state.active) return;
			state.active = false;
			editor?.clear();
			// A later factory may compose ours. Leave it installed, but inert.
			if (ctx.ui.getEditorComponent() === factory)
				ctx.ui.setEditorComponent(previous);
		},
	};
}
