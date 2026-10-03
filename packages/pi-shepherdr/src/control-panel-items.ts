import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet.js";

export const PANEL_TABS = ["Settings", "Status"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export interface PanelOwners {
	fleet: AgentFleet;
	board: AgentBoard;
	orchestration: () => boolean;
}

export function buildPanelItems(
	ctx: ExtensionContext,
	options: PanelOwners,
	tab: PanelTab,
): SettingItem[] {
	if (tab === "Status")
		return [
			{
				id: "connect",
				label: "Refresh and reconnect",
				currentValue: "Enter",
				values: ["Enter"],
				description:
					"Reload Herdr profiles and retry connections. Manage profiles in Herdr.",
			},
			...options.fleet.statuses().map((machine) => ({
				id: `machine:${machine.id}`,
				label: machine.label ?? (machine.local ? "Local" : machine.id),
				currentValue: machine.attempting ? "connecting" : machine.status,
				values: ["Enter"],
				description: [
					machine.target,
					machine.reason,
					machine.monitoringIssue
						? `Monitoring: ${machine.monitoringIssue.message}`
						: undefined,
					machine.contextRelayError
						? `Sharing: ${machine.contextRelayError}`
						: undefined,
					"Enter to reconnect.",
				]
					.filter(Boolean)
					.join("\n"),
			})),
		];
	const rows: SettingItem[] = [
		{
			id: "orchestration",
			label: "Prioritize delegation",
			currentValue: options.orchestration() ? "on" : "off",
			values: ["off", "on"],
			description: "Prefer delegation over direct work in this session.",
		},
	];
	try {
		const settings = options.board.settings(ctx);
		for (const scope of ["session", "folder", "global"] as const)
			rows.push({
				id: `board:${scope}`,
				label: `Board ${scope}`,
				currentValue:
					settings[scope] === undefined
						? "inherit"
						: settings[scope]
							? "on"
							: "off",
				values: scope === "global" ? ["off", "on"] : ["inherit", "on", "off"],
				description:
					scope === "session"
						? "Overrides folder and global defaults. Inherit removes the override."
						: scope === "folder"
							? "Default for this exact launch folder, unless overridden by the session."
							: "Default for sessions without a session or folder override.",
			});
	} catch (error) {
		rows.push({
			id: "board-owner",
			label: "Board settings",
			currentValue: "unavailable",
			description: error instanceof Error ? error.message : String(error),
		});
	}
	return rows;
}
