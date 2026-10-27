import {
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	SettingsList,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	CONVERSATION_DAYS,
	HISTORY_WINDOWS,
	RESTART_NOTICE,
	type SessionPruningPolicy,
} from "./session-pruning-policy.js";

export interface SessionPruningSettings {
	get: () => SessionPruningPolicy;
	save: (policy: SessionPruningPolicy) => void;
	run: () => Promise<void>;
}
const windowLabel = (value: number) =>
	value ? `Keep ${value} context windows` : "Off";
const ageLabel = (value: number) =>
	value === 7 ? "1 week" : value === 30 ? "1 month" : "Off";

export async function openSessionPruningSettings(
	ctx: ExtensionContext,
	options: SessionPruningSettings,
): Promise<void> {
	while (true) {
		const action = await ctx.ui.custom<"close" | "run">(
			(tui, theme, _kb, done) => {
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
							done("run");
							return;
						}
						const current = options.get();
						try {
							if (id === "windows") {
								const windows = HISTORY_WINDOWS.find(
									(item) => windowLabel(item) === value,
								);
								if (windows !== undefined)
									options.save({ ...current, windows });
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
					() => done("close"),
					{ enableSearch: false },
				);
				return {
					render: (width) => {
						const wrap = (text: string) =>
							wrapTextWithAnsi(text, Math.max(1, width - 2)).map(
								(line) => `  ${line}`,
							);
						return [
							theme.bold("  Session auto-pruning"),
							"",
							...wrap(
								"Runs once after a new context window's first completed turn commits its checkpoint. Settings follow this session on resume; new and forked sessions start Off. Forks made before restarting can retain unpruned history.",
							),
							"",
							...wrap(RESTART_NOTICE),
							"",
							...list.render(width),
							...wrap("↑/↓ select · Enter/Space change · Esc back"),
						].map((line) => truncateToWidth(line, width, ""));
					},
					invalidate: () => list.invalidate(),
					handleInput: (data) => {
						list.handleInput(data);
						tui.requestRender();
					},
				};
			},
		);
		if (action === "close") return;
		await options.run();
	}
}
