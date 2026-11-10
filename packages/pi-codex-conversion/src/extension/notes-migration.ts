import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readLegacyCodexNotesConfig } from "../adapter/activation/config-store.ts";

/** Upgrade admission only. Notes remains the sole continuity owner. */
export function registerNotesMigrationGuard(pi: ExtensionAPI): void {
	const blocked = (ctx: ExtensionContext): boolean => {
		const legacy = readLegacyCodexNotesConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
		if (!legacy) return false;
		let available = false;
		// Projection availability is independent of the user's Notes model whitelist.
		pi.events.emit("pi-notes-compaction:owner:v1", {
			protocol: 1,
			projection: () => { available = true; },
		});
		if (available) return false;
		const message = `PCC upgrade requires Notes: ${legacy.path} still sets compaction.continuity to "${legacy.continuity}", but pi-notes-compaction is not loaded or could not start. No turn will run. Install it with "pi install npm:@howaboua/pi-notes-compaction", then /reload. If already installed, enable it and resolve any Notes startup error. To continue without Notes, explicitly set compaction.continuity to "compaction" in that file.`;
		ctx.ui.notify(message, "error");
		if (!ctx.hasUI) console.error(message);
		return true;
	};
	pi.on("input", (_event, ctx) => blocked(ctx) ? { action: "handled" } : undefined);
	pi.on("before_agent_start", (_event, ctx) => {
		// Custom-message kickoffs bypass input. Hook errors alone do not stop Pi.
		if (blocked(ctx)) ctx.abort();
	});
	pi.on("session_before_compact", (_event, ctx) => blocked(ctx) ? { cancel: true } : undefined);
}
