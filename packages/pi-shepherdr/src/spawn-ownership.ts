import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	arr,
	compile,
	lit,
	obj,
	opt,
	type Static,
	str,
} from "@earendil-works/pi-schema";
import { sessionPath } from "./core/agents.js";
import type { ConnectedMachine } from "./fleet/index.js";
import type { StartAgentParams } from "./launch-contract.js";
import type { PaneInfo } from "./types.js";

const ENTRY = "herdr-spawn-ownership-v1";
const SavedLaunch = obj(
	{
		args: arr(str()),
		params: obj(
			{
				name: str(),
				cwd: str(),
				label: opt(str()),
				placement: {
					...lit("terminal"),
					type: "string",
				},
			},
			{ open: true },
		),
	},
	{ open: true },
);
const checkSavedLaunch = compile(SavedLaunch).check;
export interface SpawnOwnership {
	parent: string;
	machine: string;
	host: string;
	session: string;
	pane: string;
	terminal: string;
	sessionFile: string;
	agent?: string;
	launch?: Static<typeof SavedLaunch>;
	aliases?: string[];
}

export function spawnedChildren(ctx: ExtensionContext): SpawnOwnership[] {
	const children = new Map<string, SpawnOwnership>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const value: unknown = entry.data;
		if (!value || typeof value !== "object") continue;
		if (
			!("parent" in value && typeof value.parent === "string") ||
			!("machine" in value && typeof value.machine === "string") ||
			!("host" in value && typeof value.host === "string") ||
			!("session" in value && typeof value.session === "string") ||
			!("pane" in value && typeof value.pane === "string") ||
			!("terminal" in value && typeof value.terminal === "string") ||
			!("sessionFile" in value && typeof value.sessionFile === "string") ||
			value.parent !== ctx.sessionManager.getSessionFile()
		)
			continue;
		const child: SpawnOwnership = {
			parent: value.parent,
			machine: value.machine,
			host: value.host,
			session: value.session,
			pane: value.pane,
			terminal: value.terminal,
			sessionFile: value.sessionFile,
			...("agent" in value && typeof value.agent === "string"
				? { agent: value.agent }
				: {}),
			...("aliases" in value &&
			Array.isArray(value.aliases) &&
			value.aliases.every((alias) => typeof alias === "string")
				? { aliases: value.aliases }
				: {}),
		};
		if ("launch" in value) {
			if (!checkSavedLaunch(value.launch))
				throw new Error(
					"Saved worker launch settings are invalid; open its saved session manually",
				);
			child.launch = value.launch;
		}
		children.set(JSON.stringify([child.session, child.sessionFile]), child);
	}
	return [...children.values()];
}

// Capture before launch. A context switch must never adopt a completed spawn.
export function prepareSpawnOwnership(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	runtime: ConnectedMachine,
): (
	panel: PaneInfo,
	args: readonly string[],
	agent?: string,
	params?: StartAgentParams,
) => Promise<void> {
	const parent = ctx.sessionManager.getSessionFile();
	const anchor = ctx.sessionManager.getLeafId();
	return async (panel, args, agent, params) => {
		// Launching a resumed identity does not make that session our child.
		if (
			args.some((arg) =>
				/^(?:--(?:session(?:-id)?|continue|resume|no-session|fork)(?:=|$)|-[cr]$)/.test(
					arg,
				),
			)
		)
			return;
		const identity = await runtime.client.machineIdentity();
		const file = sessionPath(panel);
		if (
			!parent ||
			!file ||
			parent !== ctx.sessionManager.getSessionFile() ||
			(anchor &&
				!ctx.sessionManager.getBranch().some((entry) => entry.id === anchor))
		)
			throw new Error(
				"Parent context changed during spawn; retry from the intended session",
			);
		pi.appendEntry(ENTRY, {
			parent,
			machine: identity.session,
			...identity,
			pane: panel.pane_id,
			terminal: panel.terminal_id,
			sessionFile: file,
			...(agent ? { agent } : {}),
			...(params?.name && panel.cwd
				? {
						launch: {
							args: [...args],
							params: {
								name: params.name,
								...(params.label ? { label: params.label } : {}),
								cwd: panel.cwd,
								placement: "terminal",
							},
						},
					}
				: {}),
		} satisfies SpawnOwnership);
	};
}

export function recordResumedChild(
	pi: ExtensionAPI,
	child: SpawnOwnership,
	panel: PaneInfo,
	agent: string,
): void {
	pi.appendEntry(ENTRY, {
		...child,
		machine: child.session,
		agent,
		pane: panel.pane_id,
		terminal: panel.terminal_id,
		aliases: [
			...new Set([
				...(child.aliases ?? []),
				child.pane,
				child.terminal,
				...(panel.name ? [panel.name] : []),
			]),
		],
	} satisfies SpawnOwnership);
}
