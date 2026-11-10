import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ModelRole } from "./model-role-config.js";

export function openModelRoleScreen(
	ctx: ExtensionContext,
	roles: ModelRole[],
	configPath: string,
	error?: string,
) {
	return ctx.ui.custom<"notes-tab" | undefined>((tui, theme, _kb, done) => {
		let offset = 0;
		let maxOffset = 0;
		let pageSize = 1;
		return {
			render: (width: number) => {
				const content = [
					...(error ? [`Configuration error: ${error}`, ""] : []),
					...(roles.length
						? roles.flatMap((role) => [
								`${role.id}: ${role.provider}/${role.model} (${role.reasoning})`,
								role.description,
								"",
							])
						: ["No roles configured.", ""]),
					"Edit JSON to configure roles:",
					configPath,
					"Create the parent directory and file if missing. Example:",
					'{"roles":[{"id":"planning","description":"Sustained planning and design work","provider":"your-provider","model":"your-model-id","reasoning":"high"}]}',
					"Use an available Pi provider and exact model ID. Reasoning: off, minimal, low, medium, high, xhigh or max.",
					"Defined roles are available to the agent. Only role IDs and descriptions are shared with it. Legacy enabled is ignored.",
					"Changes apply on the next turn or when reopening this tab. This view is read-only.",
				].flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 4)));
				pageSize = Math.max(1, Math.min(20, tui.terminal.rows - 8));
				maxOffset = Math.max(0, content.length - pageSize);
				offset = Math.min(offset, maxOffset);
				return [
					`  ${theme.fg("dim", "Notes")}  /  ${theme.bold("Roles")}`,
					"",
					...content
						.slice(offset, offset + pageSize)
						.map((line) => `  ${line}`),
					"",
					`  Tab Notes · ↑/↓ PgUp/PgDn scroll · Esc close${maxOffset ? ` · ${offset + 1}-${Math.min(offset + pageSize, content.length)}/${content.length}` : ""}`,
				].map((line) => truncateToWidth(line, width));
			},
			invalidate: () => {},
			handleInput: (data: string) => {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab))) {
					done("notes-tab");
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(undefined);
					return;
				}
				if (matchesKey(data, Key.up)) offset--;
				else if (matchesKey(data, Key.down)) offset++;
				else if (matchesKey(data, Key.pageUp)) offset -= pageSize;
				else if (matchesKey(data, Key.pageDown)) offset += pageSize;
				else if (matchesKey(data, Key.home)) offset = 0;
				else if (matchesKey(data, Key.end)) offset = maxOffset;
				else return;
				offset = Math.max(0, Math.min(offset, maxOffset));
				tui.requestRender();
			},
		};
	});
}
