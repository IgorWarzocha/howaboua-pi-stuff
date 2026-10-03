import {
	type ExtensionContext,
	getSettingsListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	getKeybindings,
	Input,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	type TUI,
	type TuiMouseEvent,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PanelActions } from "./control-panel-actions.js";
import {
	buildPanelItems,
	type PanelOwners,
	type PanelTab,
	PANEL_TABS as TABS,
} from "./control-panel-items.js";
import type { SshSetupDraft } from "./ssh-setup.js";

const LIST_ROWS = 8;

/** Native list, field editor and mouse geometry share one selection owner. */
export class PanelView {
	private selectedRow: string | undefined;
	private editing: Input | undefined;
	private list!: SettingsList;
	private definitions: SettingItem[] = [];
	private listRowOffset = 0;
	private listHeight = 0;
	private pressedRow: string | undefined;

	private readonly ctx: ExtensionContext;
	private readonly owners: PanelOwners;
	private readonly tui: TUI;
	private readonly theme: Theme;
	tab: PanelTab;
	private readonly draft: SshSetupDraft;
	private readonly actions: PanelActions;
	private readonly current: () => boolean;
	private readonly close: () => void;

	constructor(
		ctx: ExtensionContext,
		owners: PanelOwners,
		tui: TUI,
		theme: Theme,
		tab: PanelTab,
		draft: SshSetupDraft,
		actions: PanelActions,
		current: () => boolean,
		close: () => void,
	) {
		this.ctx = ctx;
		this.owners = owners;
		this.tui = tui;
		this.theme = theme;
		this.tab = tab;
		this.draft = draft;
		this.actions = actions;
		this.current = current;
		this.close = close;
	}

	rebuild() {
		if (!this.current() || this.editing) return;
		try {
			this.definitions = buildPanelItems(
				this.ctx,
				this.owners,
				this.tab,
				this.draft,
			);
		} catch (error) {
			this.actions.message =
				error instanceof Error ? error.message : String(error);
			this.definitions = [
				{
					id: "error",
					label: "Settings unavailable",
					currentValue: "error",
					description: this.actions.message,
				},
			];
		}
		if (!this.definitions.some((item) => item.id === this.selectedRow))
			this.selectedRow = this.definitions[0]?.id;
		this.list = new SettingsList(
			this.definitions,
			LIST_ROWS,
			getSettingsListTheme(),
			(id, value) => this.change(id, value),
			this.close,
		);
		this.pressedRow = undefined;
		if (this.selectedRow) this.list.selectItem(this.selectedRow);
		this.tui.requestRender();
	}

	private change(id: string, value: string) {
		this.selectedRow = id;
		if (this.actions.busy || !this.current()) {
			this.rebuild();
			return;
		}
		if (id === "ssh:target" || id === "ssh:label" || id === "ssh:session") {
			const field =
				id === "ssh:target"
					? "target"
					: id === "ssh:label"
						? "label"
						: "session";
			const input = new Input({
				prompt: `${this.definitions.find((item) => item.id === id)?.label ?? field}: `,
			});
			input.setValue(this.draft[field]);
			input.focused = true;
			input.onSubmit = (text) => {
				this.draft[field] = text.trim();
				this.editing = undefined;
				this.actions.message = "";
				this.rebuild();
			};
			input.onEscape = () => {
				this.editing = undefined;
				this.rebuild();
			};
			this.editing = input;
			this.tui.requestRender();
			return;
		}
		this.actions.change(id, value, this.draft);
	}

	render(width: number) {
		const wrap = (text: string) =>
			text
				.split("\n")
				.flatMap((line) =>
					wrapTextWithAnsi(line, Math.max(1, width - 2)).map(
						(part) => `  ${part}`,
					),
				);
		const header = [
			this.theme.fg("accent", "─".repeat(Math.max(0, width))),
			truncateToWidth(
				`  Shepherdr · ${TABS.map((name) => (name === this.tab ? this.theme.bold(name) : this.theme.fg("dim", name))).join(" / ")}`,
				width,
				"",
			),
			"",
			...wrap(
				this.tab === "Settings"
					? this.owners.board.status(this.ctx, false)
					: this.tab === "Connections"
						? "Remote needs Node on SSH PATH and Pi with Herdr integration. Herdr prepares its server before saving."
						: `${this.owners.fleet.isActive() ? "" : "Run Pi inside Herdr. "}Add SSH targets in Connections; select a machine here to reconnect.`,
			).filter((line) => line.trim()),
			"",
		];
		const listLines = this.editing
			? this.editing.render(width)
			: this.list.render(width).slice(0, -2);
		this.listRowOffset = header.length;
		this.listHeight = listLines.length;
		return [
			...header,
			...listLines,
			...(this.actions.message
				? [
						"",
						...wrap(this.actions.message).map((line) =>
							this.theme.fg(this.actions.busy ? "dim" : "muted", line),
						),
					]
				: []),
			"",
			...wrap(
				this.editing
					? "Enter save · Esc cancel"
					: "Tab switch · ↑/↓ select · Enter change · Esc close",
			).map((line) => this.theme.fg("dim", line)),
			this.theme.fg("accent", "─".repeat(Math.max(0, width))),
		];
	}

	invalidate() {
		this.list.invalidate();
		this.editing?.invalidate();
	}

	handleMouse(event: TuiMouseEvent) {
		const y = event.y - this.listRowOffset;
		if (!this.current() || y < 0 || y >= this.listHeight) return;
		if (this.editing) return this.editing.handleMouse({ ...event, y });
		if (this.actions.busy) return { handled: true, render: false };
		const index = this.definitions.findIndex(
			(item) => item.id === this.selectedRow,
		);
		// Keep refresh selection aligned with SettingsList's visible window.
		if (event.type === "wheel" && event.wheelDelta) {
			const next = Math.max(
				0,
				Math.min(
					this.definitions.length - 1,
					index + (event.wheelDelta < 0 ? -1 : 1),
				),
			);
			this.selectedRow = this.definitions[next]?.id;
		} else if (
			event.button === "left" &&
			(event.type === "press" || event.type === "click")
		) {
			const start = Math.max(
				0,
				Math.min(
					index - Math.floor(LIST_ROWS / 2),
					this.definitions.length - LIST_ROWS,
				),
			);
			const row = start + y;
			if (
				row >= start &&
				row < Math.min(start + LIST_ROWS, this.definitions.length)
			) {
				this.selectedRow =
					event.type === "click"
						? (this.pressedRow ?? this.definitions[row]?.id)
						: this.definitions[row]?.id;
				this.pressedRow = event.type === "press" ? this.selectedRow : undefined;
			}
		}
		return this.list.handleMouse({ ...event, y, height: this.listHeight });
	}

	handleInput(data: string) {
		if (this.editing) {
			this.editing.handleInput(data);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.close();
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
			const direction = matchesKey(data, Key.tab) ? 1 : -1;
			this.tab =
				TABS[
					(TABS.indexOf(this.tab) + direction + TABS.length) % TABS.length
				] ?? "Settings";
			this.selectedRow = undefined;
			this.rebuild();
			return;
		}
		if (!this.actions.busy) {
			const kb = getKeybindings();
			if (
				kb.matches(data, "tui.select.up") ||
				kb.matches(data, "tui.select.down")
			) {
				const direction = kb.matches(data, "tui.select.up") ? -1 : 1;
				const index = this.definitions.findIndex(
					(item) => item.id === this.selectedRow,
				);
				this.selectedRow =
					this.definitions[
						(index + direction + this.definitions.length) %
							this.definitions.length
					]?.id;
			}
			this.list.handleInput(data);
		}
		this.tui.requestRender();
	}
}
