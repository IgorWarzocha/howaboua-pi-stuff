import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ConnectedMachine } from "./fleet/index.js";
import { sessionPath } from "./herdr.js";
import type { PaneInfo } from "./types.js";

const ENTRY = "herdr-spawn-ownership-v1";

export interface SpawnOwnership {
	parent: string;
	machine: string;
	host: string;
	session: string;
	pane: string;
	terminal: string;
	sessionFile: string;
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
		};
		children.set(JSON.stringify([child.machine, child.pane]), child);
	}
	return [...children.values()];
}

// Capture before launch. A context switch must never adopt a completed spawn.
export function prepareSpawnOwnership(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	runtime: ConnectedMachine,
): (panel: PaneInfo, args: readonly string[]) => Promise<void> {
	const parent = ctx.sessionManager.getSessionFile();
	const anchor = ctx.sessionManager.getLeafId();
	return async (panel, args) => {
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
			machine: runtime.machine,
			...identity,
			pane: panel.pane_id,
			terminal: panel.terminal_id,
			sessionFile: file,
		} satisfies SpawnOwnership);
	};
}
