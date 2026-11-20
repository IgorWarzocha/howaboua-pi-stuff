import {
	type ExtensionContext,
	getSelectListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	SelectList,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ModelRole } from "./model-role-config.js";

function singleLine(value: string): string {
	return Array.from(value, (char) => {
		const code = char.charCodeAt(0);
		return code < 32 || (code >= 127 && code <= 159) ? " " : char;
	}).join("");
}

export function openModelRoleScreen(
	ctx: ExtensionContext,
	roles: ModelRole[],
	configPath: string,
	error?: string,
) {
	return ctx.ui.custom<"notes-tab" | undefined>((tui, theme, _kb, done) => {
		const byId = new Map(roles.map((role) => [role.id, role]));
		const list = new SelectList(
			roles.map((role) => ({
				value: role.id,
				label: role.id,
				description: singleLine(role.description),
			})),
			Math.max(1, Math.min(10, Math.floor((tui.terminal.rows - 6) / 2))),
			getSelectListTheme(),
		);
		list.onCancel = () => done(undefined);
		let detailOffset = 0;
		let detailPage = 1;
		let detailMaxOffset = 0;
		return {
			render: (width: number) => {
				const wrap = (value: string) =>
					wrapTextWithAnsi(value, Math.max(1, width - 2)).map(
						(line) => `  ${line}`,
					);
				const selected = list.getSelectedItem();
				const role = selected && byId.get(selected.value);
				const rows = error
					? []
					: roles.length
						? list.render(width)
						: ["  No roles configured."];
				const description = selected?.description?.trim();
				const rule = theme.fg("accent", "─".repeat(width));
				const header = [
					rule,
					`  ${theme.fg("dim", "Notes")}  /  ${theme.bold("Roles")}`,
					"",
					...rows,
				];
				const details = [
					...(error
						? wrap(singleLine(error)).map((line) => theme.fg("error", line))
						: []),
					...(!error && role
						? [
								"",
								...(description &&
								!rows.some((line) => line.includes(description))
									? wrap(description)
									: []),
								...wrap(
									`Model: ${singleLine(role.provider)}/${singleLine(role.model)} · Reasoning: ${role.reasoning}`,
								).map((line) => theme.fg("dim", line)),
							]
						: []),
					"",
					...wrap(`Configuration: ${singleLine(configPath)}`).map((line) =>
						theme.fg("dim", line),
					),
				];
				const hint = `Tab Notes · ${!error && roles.length > 1 ? "↑/↓ select · " : ""}Esc close`;
				const pagingHint = wrap(`${hint} · PgUp/PgDn details`);
				detailPage = Math.max(
					1,
					tui.terminal.rows - header.length - pagingHint.length - 3,
				);
				detailMaxOffset = Math.max(0, details.length - detailPage);
				detailOffset = Math.min(detailOffset, detailMaxOffset);
				return [
					...header,
					...details.slice(detailOffset, detailOffset + detailPage),
					...(detailMaxOffset ? pagingHint : wrap(hint)).map((line) =>
						theme.fg("dim", line),
					),
					rule,
				].map((line) => truncateToWidth(line, width, ""));
			},
			invalidate: () => list.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
					done("notes-tab");
					return;
				}
				if (detailMaxOffset && matchesKey(data, Key.pageUp)) {
					detailOffset = Math.max(0, detailOffset - detailPage);
				} else if (detailMaxOffset && matchesKey(data, Key.pageDown)) {
					detailOffset = Math.min(detailMaxOffset, detailOffset + detailPage);
				} else {
					const previous = list.getSelectedItem();
					list.handleInput(data);
					if (list.getSelectedItem() !== previous) detailOffset = 0;
				}
				tui.requestRender();
			},
		};
	});
}
