import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet.js";
import type { SharedAgentContext } from "./shared-context.js";
import type { PaneInfo } from "./types.js";

export const PANEL_TABS = ["Orchestration", "Sharing", "Connections"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export interface PanelTarget {
	key: string;
	machine: string;
	panel: PaneInfo;
}
export interface PanelOwners {
	fleet: AgentFleet;
	board: AgentBoard;
	shared: SharedAgentContext;
	orchestration: () => boolean;
}
interface PanelSelection {
	tab: PanelTab;
	targets: PanelTarget[];
	selected: string | undefined;
	contextChoice: boolean;
	boardChoice: boolean;
}
const actionRow = (
	id: string,
	label: string,
	description: string,
): SettingItem => ({
	id,
	label,
	description,
	currentValue: "Enter",
	values: ["Enter"],
});

export function buildPanelItems(
	ctx: ExtensionContext,
	options: PanelOwners,
	selection: PanelSelection,
): SettingItem[] {
	const { tab, targets, selected, contextChoice, boardChoice } = selection;
	if (tab === "Orchestration")
		return [
			{
				id: "orchestration",
				label: "Prioritize delegation",
				currentValue: options.orchestration() ? "on" : "off",
				values: ["off", "on"],
				description:
					"On asks the agent to orchestrate suitable work and synthesize results. Off delegates only when useful or requested. Changes guidance for this session without starting a turn.",
			},
		];
	if (tab === "Connections")
		return [
			actionRow(
				"connect",
				"Refresh catalog and reconnect",
				"Read Herdr's enabled machine profiles and retry failed connections or incomplete setup. Working connections remain intact. Manage profiles in Herdr.",
			),
			...options.fleet.statuses().map((machine) => ({
				...actionRow(
					`machine:${machine.id}`,
					`${machine.label ?? machine.id} [${machine.id}]`,
					[
						machine.target
							? `${machine.target}, Herdr session ${machine.session}.`
							: "Local means the host running Pi.",
						machine.reason,
						machine.monitoringIssue
							? `Monitoring: ${machine.monitoringIssue.message}`
							: undefined,
						machine.contextRelayError
							? `Sharing: ${machine.contextRelayError}`
							: undefined,
						"Enter retries this machine's connection or incomplete setup.",
					]
						.filter(Boolean)
						.join("\n"),
				),
				currentValue: machine.attempting ? "connecting" : machine.status,
			})),
		];
	const rows: SettingItem[] = [];
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
						? "Overrides folder and global defaults. Inherit removes this session's override. Survives resume, not forks."
						: scope === "folder"
							? "Default for this exact launch folder, not child directories. A session override can mask this choice. Inherit uses the global default."
							: "Default for root sessions without a session or folder override. Does not override either setting.",
			});
	} catch (error) {
		rows.push({
			id: "board-owner",
			label: "Board settings",
			currentValue: "unavailable",
			description: String(error),
		});
	}
	rows.push(
		actionRow(
			"targets",
			"Refresh existing agents",
			"Discover Pi agents on connected machines. Does not start tasks, watches or attachments.",
		),
	);
	if (targets.length)
		rows.push({
			id: "target",
			label: "Existing agent",
			currentValue: selected ?? targets[0]?.key ?? "",
			values: targets.map((entry) => entry.key),
			description:
				"Select an agent, then explicitly attach or detach below. Both sessions must be saved and settled. Refresh if the target has changed.",
		});
	const entry = targets.find((entry) => entry.key === selected);
	const shared = options.shared.summary(ctx);
	const memberships: SettingItem[] = [];
	for (const child of shared.children)
		memberships.push({
			id: `context-member:${child.agentName}`,
			label: `Context member ${child.agentName}`,
			currentValue: child.machine,
			description: `${child.agentName}\nSpawned family member. Native family bindings are not detachable attachments. Live access requires its owner and machine connection.`,
		});
	for (const member of options.board.summary(ctx).members)
		memberships.push({
			id: `board-member:${member.agentName}`,
			label: `Board member ${member.agentName}`,
			currentValue: "member",
			description: `${member.agentName}\nBoard identity for session ${member.sessionId}. Board membership is independent of context access.`,
		});
	for (const member of shared.attachments)
		memberships.push({
			id: `attachment:${member.role}:${member.machine ?? ""}:${member.sessionId}`,
			label: `${member.role === "target" ? "Controller" : member.machine} ${member.sessionId}`,
			currentValue: member.phase,
			description: `Context ${member.context}, board ${member.board}.${member.contextAgent ? `\nContext alias: ${member.contextAgent}` : ""}${member.boardAgent ? `\nBoard alias: ${member.boardAgent}` : ""}${member.role === "target" ? "\nManage this attachment from its original controller." : "\nSelect this session's live Pi agent to detach or retry."}`,
		});
	if (!entry) return [...rows, ...memberships];
	const member = options.shared.attachment.membership(
		ctx,
		entry.machine,
		entry.panel,
	);
	if (member) {
		if (member.phase === "pending")
			rows.push(
				actionRow(
					"attach",
					"Retry original attachment",
					"The target may already be attached. Retry the original choices from these same sessions.",
				),
			);
		else {
			if (member.context !== "none")
				rows.push(
					actionRow(
						"detach-context",
						member.context === "detached"
							? "Retry context detach"
							: "Detach context",
						"Stop live context access. Retain latest counterpart notes read-only under the existing aliases. History still needs a live owner. Reattachment is unsupported. Retry reconciles an interrupted detach from these same sessions.",
					),
				);
			if (member.board !== "none")
				rows.push(
					actionRow(
						"detach-board",
						member.board === "detached" ? "Retry board detach" : "Detach board",
						"Restore the target's previous board and stop shared-board notifications. Neither archive is deleted. Targets with board children cannot detach. Reattachment is unsupported. Retry reconciles an interrupted detach from these same sessions.",
					),
				);
		}
	} else {
		rows.push(
			{
				id: "context-choice",
				label: "Attach context",
				currentValue: contextChoice ? "yes" : "no",
				values: ["no", "yes"],
				description:
					"Share notes and history through aliases. Requires updated Codex Conversion and Local or Tree storage on both agents. Does not move notes or change native identities. Explicit attachment is independent of spawn sharing.",
			},
			{
				id: "board-choice",
				label: "Attach board",
				currentValue: boardChoice ? "yes" : "no",
				values: ["no", "yes"],
				description:
					"Join this controller's enabled board. The target's previous archive stays untouched. Works without Codex Conversion and independently of context attachment.",
			},
			actionRow(
				"attach",
				"Attach selected choices",
				"Enable at least one choice above. Targets support one controller and a fixed set of choices. No task or watch is started. Existing family members cannot be rebound.",
			),
		);
	}
	return [...rows, ...memberships];
}
