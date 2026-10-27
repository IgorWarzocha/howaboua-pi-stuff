import {
	type ExtensionContext,
	getSelectListTheme,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	SelectList,
	SettingsList,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SessionPruningInteraction } from "./session-pruning.js";
import {
	CONVERSATION_DAYS,
	HISTORY_WINDOWS,
	RESTART_NOTICE,
	type SessionPruningPolicy,
} from "./session-pruning-policy.js";

export interface SessionPruningSettings {
	get: () => SessionPruningPolicy;
	save: (policy: SessionPruningPolicy) => void;
	run: (interaction: SessionPruningInteraction) => Promise<void>;
}
const windowLabel = (value: number) =>
	value ? `Keep ${value} context windows` : "Off";
const ageLabel = (value: number) =>
	value === 7 ? "1 week" : value === 30 ? "1 month" : "Off";

export async function openSessionPruningSettings(
	ctx: ExtensionContext,
	options: SessionPruningSettings,
): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		type State =
			| { kind: "idle" }
			| { kind: "busy"; message: string }
			| {
					kind: "confirm";
					title: string;
					message: string;
					choices: SelectList;
			  };
		let state: State = { kind: "idle" };
		const progress = (message: string) => {
			state = { kind: "busy", message };
			tui.requestRender();
		};
		const confirm: SessionPruningInteraction["confirm"] = (title, message) =>
			new Promise((resolve) => {
				const choices = new SelectList(
					[
						{ value: "no", label: "Cancel" },
						{ value: "yes", label: "Prune permanently" },
					],
					2,
					getSelectListTheme(),
				);
				const finish = (approved: boolean) => {
					progress(
						approved ? "Pruning session history…" : "Cancelling preview…",
					);
					resolve(approved);
				};
				choices.onSelect = (item) => finish(item.value === "yes");
				choices.onCancel = () => finish(false);
				state = { kind: "confirm", title, message, choices };
				tui.requestRender();
			});
		const run = async () => {
			progress("Waiting for the current turn to finish…");
			try {
				await options.run({ progress, confirm });
			} catch (error) {
				ctx.ui.notify(
					`Session pruning did not complete: ${String(error)}`,
					"error",
				);
			} finally {
				state = { kind: "idle" };
				list.updateValue("run", "select…");
				tui.requestRender();
			}
		};
		const policy = options.get();
		const list = new SettingsList(
			[
				{
					id: "windows",
					label: "Full/tool history",
					currentValue: windowLabel(policy.windows),
					values: HISTORY_WINDOWS.map(windowLabel),
					description:
						"This session only. Outside retained windows, keep actual user messages (including attachments) and assistant prose, not tools or injected instructions. Off leaves full history intact.",
				},
				{
					id: "days",
					label: "Assistant & user messages",
					currentValue: ageLabel(policy.days),
					values: CONVERSATION_DAYS.map(ageLabel),
					description:
						"Expire conversation older than this limit, independently of full-history retention. The current context window and native active context are always protected.",
				},
				{
					id: "run",
					label: "Run now",
					currentValue: "select…",
					values: ["select…", "preview…"],
					description:
						"Preview and confirm irreversible pruning. Saved SQLite notes are never deleted. No archive or backup is kept.",
				},
			],
			5,
			getSettingsListTheme(),
			(id, value) => {
				if (id === "run") {
					void run();
					return;
				}
				const current = options.get();
				try {
					if (id === "windows") {
						const windows = HISTORY_WINDOWS.find(
							(item) => windowLabel(item) === value,
						);
						if (windows !== undefined) options.save({ ...current, windows });
					} else {
						const days = CONVERSATION_DAYS.find(
							(item) => ageLabel(item) === value,
						);
						if (days !== undefined) options.save({ ...current, days });
					}
				} catch (error) {
					list.updateValue(
						id,
						id === "windows"
							? windowLabel(current.windows)
							: ageLabel(current.days),
					);
					ctx.ui.notify(
						`Could not save session pruning settings: ${String(error)}`,
						"error",
					);
				}
				tui.requestRender();
			},
			() => done(),
			{ enableSearch: false },
		);
		return {
			render: (width) => {
				const wrap = (text: string) =>
					wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
						(line) => `  ${line}`,
					);
				const rule = theme.fg("accent", "─".repeat(Math.max(0, width)));
				return [
					rule,
					theme.bold("  Session auto-pruning"),
					"",
					...wrap(
						"Runs once after a new context window's first completed turn commits its checkpoint. Settings follow this session on resume; new and forked sessions start Off. Forks made before restarting can retain unpruned history.",
					),
					"",
					...wrap(RESTART_NOTICE),
					"",
					...(state.kind === "confirm"
						? [
								...wrap(theme.bold(state.title)),
								...wrap(state.message),
								"",
								...state.choices.render(width),
							]
						: list.render(width).slice(0, -2)),
					"",
					...wrap(
						state.kind === "busy"
							? state.message
							: state.kind === "confirm"
								? "↑/↓ select · Enter confirm · Esc cancel"
								: "↑/↓ select · Enter/Space change · Esc back",
					).map((line) =>
						theme.fg(state.kind === "busy" ? "accent" : "dim", line),
					),
					...(state.kind === "busy"
						? wrap("Please wait; settings and closing are paused.").map(
								(line) => theme.fg("dim", line),
							)
						: []),
					rule,
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => {
				list.invalidate();
				if (state.kind === "confirm") state.choices.invalidate();
			},
			handleInput: (data) => {
				if (state.kind === "idle") list.handleInput(data);
				else if (state.kind === "confirm") state.choices.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
