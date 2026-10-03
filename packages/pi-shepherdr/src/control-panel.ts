import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	getKeybindings,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	type TuiMouseEvent,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	buildPanelItems,
	type PanelOwners,
	PANEL_TABS as TABS,
	type PanelTab as Tab,
} from "./control-panel-items.js";

interface PanelOptions extends PanelOwners {
	setOrchestration: (enabled: boolean, signal: AbortSignal) => Promise<void>;
	reconnect: (
		machine: string | undefined,
		signal: AbortSignal,
	) => Promise<string>;
	signal: AbortSignal;
}

const LIST_ROWS = 8;

export function controlPanelStatus(
	ctx: ExtensionContext,
	options: PanelOptions,
): string {
	return [
		`Orchestration ${options.orchestration() ? "on" : "off"}.`,
		options.board.status(ctx),
		...options.fleet
			.statuses()
			.map(
				(machine) =>
					`${machine.label ?? machine.id} [${machine.id}]: ${machine.status}${machine.reason ? `\n${machine.reason}` : ""}${machine.monitoringIssue ? `\nMonitoring: ${machine.monitoringIssue.message}` : ""}${machine.contextRelayError ? `\nSharing: ${machine.contextRelayError}` : ""}`,
			),
		...(!options.fleet.isActive()
			? [
					"Fleet inactive. Run Pi inside Herdr; /herdr connect retries activation.",
				]
			: []),
		"/herdr orchestration on|off changes guidance without starting a turn.",
	].join("\n");
}

export async function openControlPanel(
	ctx: ExtensionContext,
	options: PanelOptions,
	initialRow?: string,
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const lifetime = new AbortController();
	const signal = AbortSignal.any([options.signal, lifetime.signal]);
	signal.throwIfAborted();
	await ctx.ui
		.custom<void>((tui, theme, _kb, done) => {
			let tab: Tab = "Settings";
			let busy = false;
			let message = "";
			let selectedRow = initialRow;
			let list: SettingsList;
			let definitions: SettingItem[] = [];
			let listRowOffset = 0;
			let listHeight = 0;
			let pressedRow: string | undefined;
			let disposed = false;
			const current = () =>
				!disposed &&
				!signal.aborted &&
				ctx.sessionManager.getSessionId() === sessionId;
			const check = () => {
				signal.throwIfAborted();
				if (!current()) throw new Error("Session changed; reopen /herdr");
			};
			const rebuild = () => {
				if (!current()) return;
				try {
					definitions = buildPanelItems(ctx, options, tab);
				} catch (error) {
					message = error instanceof Error ? error.message : String(error);
					definitions = [
						{
							id: "error",
							label: "Settings unavailable",
							currentValue: "error",
							description: message,
						},
					];
				}
				if (!definitions.some((item) => item.id === selectedRow))
					selectedRow = definitions[0]?.id;
				list = new SettingsList(
					definitions,
					LIST_ROWS,
					getSettingsListTheme(),
					change,
					close,
				);
				pressedRow = undefined;
				if (selectedRow) list.selectItem(selectedRow);
				tui.requestRender();
			};
			const run = (work: () => Promise<void>) => {
				if (busy || !current()) {
					rebuild();
					return;
				}
				busy = true;
				message = "Working...";
				tui.requestRender();
				void (async () => {
					try {
						check();
						await work();
					} catch (error) {
						if (current())
							message = error instanceof Error ? error.message : String(error);
					} finally {
						busy = false;
						rebuild();
					}
				})();
			};
			function change(id: string, value: string) {
				selectedRow = id;
				if (busy || !current()) {
					rebuild();
					return;
				}
				run(async () => {
					if (id === "orchestration") {
						await options.setOrchestration(value === "on", signal);
						message = "Guidance saved for this session.";
					} else if (
						id === "board:session" ||
						id === "board:folder" ||
						id === "board:global"
					) {
						await options.board.setSetting(
							ctx,
							id === "board:session"
								? "session"
								: id === "board:folder"
									? "folder"
									: "global",
							value === "inherit" ? undefined : value === "on",
						);
						check();
						message = "Board setting saved.";
					} else if (id === "connect" || id.startsWith("machine:"))
						message = await options.reconnect(
							id === "connect" ? undefined : id.slice(8),
							signal,
						);
				});
			}
			function close() {
				if (disposed) return;
				disposed = true;
				lifetime.abort();
				done(undefined);
			}
			const subscriptions = [
				options.fleet.subscribe(rebuild),
				options.board.subscribe(rebuild),
			];
			signal.addEventListener("abort", close, { once: true });
			rebuild();
			if (signal.aborted) close();
			return {
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
						theme.fg("accent", "─".repeat(Math.max(0, width))),
						truncateToWidth(
							`  Shepherdr · ${TABS.map((name) => (name === tab ? theme.bold(name) : theme.fg("dim", name))).join(" / ")}`,
							width,
							"",
						),
						"",
						...wrap(
							tab === "Settings"
								? options.board.status(ctx, false)
								: options.fleet.isActive()
									? ""
									: "Pi must run inside Herdr. Reconnect retries activation.",
						).filter((line) => line.trim()),
						"",
					];
					const listLines = list.render(width).slice(0, -2);
					listRowOffset = header.length;
					listHeight = listLines.length;
					return [
						...header,
						...listLines,
						...(message
							? [
									"",
									...wrap(message).map((line) =>
										theme.fg(busy ? "dim" : "muted", line),
									),
								]
							: []),
						"",
						...wrap("Tab switch · ↑/↓ select · Enter change · Esc close").map(
							(line) => theme.fg("dim", line),
						),
						theme.fg("accent", "─".repeat(Math.max(0, width))),
					];
				},
				invalidate: () => list.invalidate(),
				handleMouse(event: TuiMouseEvent) {
					const y = event.y - listRowOffset;
					if (!current() || y < 0 || y >= listHeight) return;
					if (busy) return { handled: true, render: false };
					const index = definitions.findIndex(
						(item) => item.id === selectedRow,
					);
					// Keep the wrapper's refresh selection aligned with SettingsList's visible window.
					if (event.type === "wheel" && event.wheelDelta) {
						const next = Math.max(
							0,
							Math.min(
								definitions.length - 1,
								index + (event.wheelDelta < 0 ? -1 : 1),
							),
						);
						selectedRow = definitions[next]?.id;
					} else if (
						event.button === "left" &&
						(event.type === "press" || event.type === "click")
					) {
						const start = Math.max(
							0,
							Math.min(
								index - Math.floor(LIST_ROWS / 2),
								definitions.length - LIST_ROWS,
							),
						);
						const row = start + y;
						if (
							row >= start &&
							row < Math.min(start + LIST_ROWS, definitions.length)
						) {
							selectedRow =
								event.type === "click"
									? (pressedRow ?? definitions[row]?.id)
									: definitions[row]?.id;
							pressedRow = event.type === "press" ? selectedRow : undefined;
						}
					}
					return list.handleMouse({ ...event, y, height: listHeight });
				},
				handleInput(data: string) {
					if (matchesKey(data, Key.escape)) {
						close();
						return;
					}
					if (
						matchesKey(data, Key.tab) ||
						matchesKey(data, Key.shift(Key.tab))
					) {
						const direction = matchesKey(data, Key.tab) ? 1 : -1;
						tab =
							TABS[
								(TABS.indexOf(tab) + direction + TABS.length) % TABS.length
							] ?? "Settings";
						selectedRow = undefined;
						rebuild();
						return;
					}
					if (!busy) {
						const kb = getKeybindings();
						if (
							kb.matches(data, "tui.select.up") ||
							kb.matches(data, "tui.select.down")
						) {
							const direction = kb.matches(data, "tui.select.up") ? -1 : 1;
							const index = definitions.findIndex(
								(item) => item.id === selectedRow,
							);
							selectedRow =
								definitions[
									(index + direction + definitions.length) % definitions.length
								]?.id;
						}
						list.handleInput(data);
					}
					tui.requestRender();
				},
				dispose() {
					disposed = true;
					signal.removeEventListener("abort", close);
					for (const unsubscribe of subscriptions) unsubscribe();
					lifetime.abort();
				},
			};
		})
		.finally(() => lifetime.abort());
}
