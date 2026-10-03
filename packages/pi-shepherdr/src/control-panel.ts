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
	type PanelTarget as Target,
} from "./control-panel-items.js";
import { resolvePiAgent } from "./herdr.js";

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
	const context = options.shared.summary(ctx);
	return [
		`Orchestration ${options.orchestration() ? "on" : "off"}. Agents, tools and monitoring work in either mode.`,
		options.board.status(ctx),
		`Context: ${context.agentName ?? "unavailable"}. New spawn sharing ${context.spawnSharing ? "on" : "off"}.`,
		...(context.contextError
			? [`Context unavailable: ${context.contextError}. Check /codex context.`]
			: []),
		...context.attachments.map(
			(member) =>
				`${member.machine ?? "Controller"} ${member.sessionId}: context ${member.context}, board ${member.board} (${member.phase})`,
		),
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
	initialTab: Tab = "Orchestration",
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const lifetime = new AbortController();
	const signal = AbortSignal.any([options.signal, lifetime.signal]);
	signal.throwIfAborted();
	await ctx.ui
		.custom<void>((tui, theme, _kb, done) => {
			let tab: Tab = initialTab;
			let busy = false;
			let message = "";
			let targets: Target[] = [];
			let selected: string | undefined;
			let contextChoice = false;
			let boardChoice = false;
			let selectedRow: string | undefined;
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
			const target = () => targets.find((entry) => entry.key === selected);
			const membership = () => {
				const entry = target();
				return entry
					? options.shared.attachment.membership(
							ctx,
							entry.machine,
							entry.panel,
						)
					: undefined;
			};
			const rebuild = () => {
				if (!current()) return;
				try {
					definitions = buildPanelItems(ctx, options, {
						tab,
						targets,
						selected,
						contextChoice,
						boardChoice,
					});
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
				message =
					"Working... Esc closes and cancels pending panel requests. A remote change may already have committed.";
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
			const loadTargets = async () => {
				const machines = await options.fleet.snapshots();
				check();
				targets = machines.flatMap((machine) =>
					(machine.snapshot?.agents ?? [])
						.filter(
							(panel) =>
								panel.agent === "pi" &&
								(!machine.local ||
									panel.pane_id !== process.env["HERDR_PANE_ID"]),
						)
						.map((panel) => ({
							key: `${machine.id} ${panel.pane_id} ${panel.label ?? panel.name ?? "Pi"}`,
							machine: machine.id,
							panel,
						})),
				);
				if (!targets.some((entry) => entry.key === selected))
					selected = targets[0]?.key;
				message =
					machines
						.filter((machine) => machine.snapshotError)
						.map((machine) => `${machine.id}: ${machine.snapshotError}`)
						.join("\n") ||
					(targets.length
						? "Select an existing agent below."
						: "No other Pi agents found on connected machines.");
			};
			const attach = async (detach: "context" | "board" | undefined) => {
				const entry = target();
				if (!entry)
					throw new Error("Refresh and select an existing agent first");
				if (!ctx.isIdle())
					throw new Error("Change membership after this session settles");
				const runtime = options.fleet.connected(entry.machine);
				const panel = await resolvePiAgent(
					runtime.client,
					entry.panel.pane_id,
					runtime.local ? process.env["HERDR_PANE_ID"] : "",
				);
				check();
				// A pane can resume a different session while the panel is open.
				if (panel.agent_session?.value !== entry.panel.agent_session?.value)
					throw new Error(
						"Target session changed; refresh existing agents before retrying",
					);
				const member = membership();
				const context = detach
					? detach === "context"
					: member
						? member.context !== "none"
						: contextChoice;
				const board = detach
					? detach === "board"
					: member
						? member.board !== "none"
						: boardChoice;
				if (!context && !board)
					throw new Error("Choose context or board before attaching");
				await options.shared.attachment[detach ? "detach" : "attach"](
					ctx,
					runtime,
					panel,
					{ action: detach ? "detach" : "attach", context, board },
					signal,
				);
				check();
				message = detach
					? `${detach === "context" ? "Context" : "Board"} detached.`
					: "Attachment complete. No task or watch started.";
			};
			function change(id: string, value: string) {
				selectedRow = id;
				if (busy || !current()) {
					rebuild();
					return;
				}
				if (id === "context-choice") {
					contextChoice = value === "yes";
					return;
				}
				if (id === "board-choice") {
					boardChoice = value === "yes";
					return;
				}
				if (id === "target") {
					selected = value;
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
					else if (id === "targets") await loadTargets();
					else if (
						id === "attach" ||
						id === "detach-context" ||
						id === "detach-board"
					)
						await attach(
							id === "attach"
								? undefined
								: id === "detach-context"
									? "context"
									: "board",
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
				options.shared.subscribe(rebuild),
			];
			signal.addEventListener("abort", close, { once: true });
			rebuild();
			if (signal.aborted) close();
			else if (tab === "Sharing") run(loadTargets);
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
					const details: string[] = [];
					if (tab === "Orchestration")
						details.push(
							"Agents and their tools are available in either mode. Fleet monitoring continues independently. New sessions use normal guidance; resumed sessions restore the last choice.",
						);
					if (tab === "Connections" && !options.fleet.isActive())
						details.push(
							"Fleet inactive. Pi must run inside Herdr. Refresh catalog and reconnect retries activation.",
						);
					if (tab === "Sharing") {
						const shared = options.shared.summary(ctx);
						const board = options.board.summary(ctx);
						details.push(
							options.board.status(ctx),
							`Context: ${shared.agentName ?? (shared.contextError ? "unavailable" : shared.available ? "inactive in this session" : "Codex Conversion unavailable")}${shared.storage ? ` (${shared.storage})` : ""}. New spawn sharing ${shared.spawnSharing ? "on" : "off"}. Configure continuity, storage and spawn sharing in /codex context.`,
							...(shared.contextError
								? [
										`Context unavailable: ${shared.contextError}. Check /codex context. Board controls remain independent.`,
									]
								: []),
							"Board setting and context access are independent. Membership survives resume, not forks. Live access needs owners and machine connections. Detached notes are read-only; reattachment is unsupported.",
						);
						if (board.inherited)
							details.push(
								"Board setting inherited from its root. Change defaults in that root session.",
							);
						const selectedTarget = target();
						if (selectedTarget) {
							const native = options.shared.member(
								ctx,
								selectedTarget.machine,
								selectedTarget.panel,
							);
							details.push(
								`Selected: ${selectedTarget.key}. Context ${membership()?.context ?? native.contextAgent ?? (native.contextError ? "unavailable" : "not shared here")}, board ${membership()?.board ?? native.boardAgent ?? "not shared here"}.`,
							);
							if (
								native.contextError &&
								native.contextError !== shared.contextError
							)
								details.push(
									`Context unavailable: ${native.contextError}. Check /codex context.`,
								);
						}
					}
					const header = [
						theme.fg("accent", "─".repeat(Math.max(0, width))),
						truncateToWidth(
							`  Shepherdr · ${TABS.map((name) => (name === tab ? theme.bold(name) : theme.fg("dim", name))).join(" / ")}`,
							width,
							"",
						),
						"",
						...details.flatMap(wrap),
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
						...wrap(
							"Tab/Shift+Tab sections · ↑/↓ select · Enter/Space change · Esc close",
						).map((line) => theme.fg("dim", line)),
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
							] ?? "Orchestration";
						selectedRow = undefined;
						rebuild();
						if (tab === "Sharing" && !targets.length && !busy) run(loadTargets);
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
