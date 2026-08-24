import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parsePersistedContextDetails } from "./details.js";
import { resolvePath } from "./paths.js";

export function collectBranchContext(
	ctx: ExtensionContext,
	currentCwd: string,
	cwdAgentsPath: string,
): Map<string, string> {
	const out = new Map<string, string>();
	const branchEntries = ctx.sessionManager.getBranch();
	for (const entry of branchEntries) {
		if (!entry || typeof entry !== "object" || entry.type !== "message")
			continue;
		const message = (entry as { message?: unknown }).message;
		if (!message || typeof message !== "object" || Array.isArray(message))
			continue;
		const details = (message as { details?: unknown }).details;
		const persisted = parsePersistedContextDetails(details);
		if (!persisted) continue;
		for (const file of persisted.files) {
			const absolute = resolvePath(file.path, currentCwd);
			if (path.basename(absolute) !== "AGENTS.md" || absolute === cwdAgentsPath)
				continue;
			out.set(absolute, file.content);
		}
	}
	return out;
}
