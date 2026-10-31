import { join } from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createNotesActivation } from "./activation.js";
import { createNotesContextOwner } from "./context-owner.js";
import { registerNotesHooks } from "./extension-hooks.js";
import { registerNotesSharing } from "./extension-sharing.js";
import { HistorySearch } from "./history-search.js";
import { registerNotesToolIntegrations } from "./integrations.js";
import { NotesLifecycle } from "./lifecycle.js";
import { createModelRoles } from "./model-roles.js";
import { registerNoteSaveMarkers } from "./note-save-marker.js";
import { SessionPruning } from "./session-pruning.js";
import { registerNotesSettingsCommand } from "./settings-command.js";
import { NotesStore } from "./store.js";
import { createTools } from "./tools.js";
import { WindowCheckpoints } from "./window-checkpoint.js";
import { registerWindowRenderer } from "./windows.js";

export default async function notesCompaction(pi: ExtensionAPI): Promise<void> {
	registerWindowRenderer(pi);
	const dir = join(getAgentDir(), "notes-compaction");
	const settingsPath = join(dir, "settings.json");
	const store = new NotesStore(join(dir, "notes.sqlite"));
	const search = new HistorySearch(join(dir, "history-search.sqlite"));
	const lifecycle = new NotesLifecycle(pi, store);
	const checkpoints = new WindowCheckpoints((entries) =>
		lifecycle.windows.projectBranch(entries),
	);
	let refreshNested = () => {};
	const activation = createNotesActivation(
		pi,
		store,
		search,
		lifecycle,
		settingsPath,
		() => refreshNested(),
	);
	const stopAdmission = pi.events.on(
		"pi-notes-compaction:custom-turn-admission:v1",
		(value) => {
			const request = value as {
				protocol?: number;
				ctx: Parameters<NotesLifecycle["prepareCustomTurn"]>[0];
				preparation?: Promise<void>;
			};
			if (request?.protocol === 1 && !request.preparation) {
				activation.refreshActivation(request.ctx);
				request.preparation = (async () => {
					if (activation.available && request.ctx.isIdle())
						await checkpoints.restore(request.ctx);
					await lifecycle.prepareCustomTurn(request.ctx);
				})();
			}
		},
	);
	const roles = createModelRoles(pi, activation, lifecycle);
	const tools = createTools(pi, store, lifecycle, search, roles);
	refreshNested = await registerNotesToolIntegrations(
		pi,
		lifecycle,
		activation,
		tools,
	);
	for (const tool of tools) pi.registerTool(tool);
	const owner = createNotesContextOwner(pi, store, lifecycle, search);
	const { family, stopOwner } = await registerNotesSharing(
		pi,
		owner,
		activation,
		lifecycle,
	);
	const markers = registerNoteSaveMarkers(
		pi,
		() => lifecycle.active && activation.settings.noteSaveMarkers,
	);
	await registerNotesHooks(
		pi,
		activation,
		lifecycle,
		owner,
		checkpoints,
		markers,
		family,
	);
	const sessionPruning = new SessionPruning(
		pi,
		store,
		search,
		() => lifecycle.windows.current?.currentWindowId,
	);
	sessionPruning.register();
	pi.on("session_shutdown", () => {
		lifecycle.reset();
		lifecycle.active = false;
		store.close();
		search.close();
		stopOwner();
		stopAdmission();
	});
	registerNotesSettingsCommand(
		pi,
		activation,
		lifecycle,
		store,
		search,
		settingsPath,
		sessionPruning,
		roles,
	);
}
