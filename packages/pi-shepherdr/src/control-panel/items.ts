import type { SettingItem } from "@earendil-works/pi-tui";
import { commandConfigPath } from "../command-config.js";
import type { AgentFleet } from "../fleet/index.js";
import { type SshSetupDraft, sshSetupItems } from "../ssh-setup.js";

export const PANEL_TABS = ["Settings", "Status", "Connections"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export interface PanelOwners {
	fleet: AgentFleet;
	orchestration: () => boolean;
}

export function buildPanelItems(
	options: PanelOwners,
	tab: PanelTab,
	draft: SshSetupDraft,
): SettingItem[] {
	if (tab === "Connections") {
		if (process.env["HC_TERMINAL_SOCKET"])
			return [
				{
					id: "core-machines",
					label: "Manage machines in Herdr or with hc machine add",
					currentValue: "",
				},
			];
		return sshSetupItems(draft);
	}
	if (tab === "Status")
		return [
			{
				id: "connect",
				label: "Refresh and reconnect",
				currentValue: "Enter",
				values: ["Enter"],
				description: process.env["HC_TERMINAL_SOCKET"]
					? "Refresh Core machines and retry connections."
					: "Reload Herdr profiles and retry connections.",
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
	return [
		{
			id: "agent-commands",
			label: "Agent commands",
			currentValue: "",
			description: `Built-in commands and skills are available. Custom extension commands require an allowlist in Shepherdr’s config. Prompt templates are also supported, but you will need to inform your agent about their existence separately.\nConfig: ${commandConfigPath()}`,
		},
		{
			id: "orchestration",
			label: "Prioritize delegation",
			currentValue: options.orchestration() ? "on" : "off",
			values: ["off", "on"],
			description: "Prefer delegation over direct work in this session.",
		},
	];
}
