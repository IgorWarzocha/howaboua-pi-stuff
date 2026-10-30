import { isDeepStrictEqual } from "node:util";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { contextTargetAgent } from "./agent-identity.js";
import {
	readAttachmentSnapshot,
	readRemoteNoteReference,
} from "./attachment-snapshot.js";
import type { ContextSharingService } from "./context-sharing.js";
import { exportNotesSnapshot } from "./notes.js";

export function createAttachmentSharing(
	describe: ContextSharingService["describe"],
) {
	return {
		exportAttachmentNotes(ctx) {
			const identity = describe(ctx);
			if (!identity)
				throw new Error("Checkpoint export requires notes-based continuity");
			if (identity.storage === "remote") {
				if (!identity.backendUrl)
					throw new Error("Saved remote context has no backend address");
				return {
					protocol: 1,
					storage: "remote",
					timestamp: Date.now(),
					identity,
					baseUrl: identity.backendUrl,
				};
			}

			const snapshot = exportNotesSnapshot(
				ctx.sessionManager.getBranch(),
				identity.agentName,
			);
			return {
				...snapshot,
				files: snapshot.files.filter(
					(file) =>
						contextTargetAgent(
							"notes",
							{ path: file.path },
							identity.agentName,
						) === identity.agentName,
				),
			};
		},
		validateAttachmentNotes(snapshot, identity) {
			if (identity.storage === "remote") {
				if (
					!isDeepStrictEqual(
						readRemoteNoteReference(snapshot).identity,
						identity,
					)
				)
					throw new Error("Remote checkpoint owner changed");
			} else
				readAttachmentSnapshot(snapshot, {
					action: "list_files_by_prefix",
					prefix: `${identity.agentName}/notes`,
				});
		},
		async verifyAttachmentAccess(ctx, snapshot) {
			if (
				!snapshot ||
				typeof snapshot !== "object" ||
				!("storage" in snapshot) ||
				snapshot.storage !== "remote"
			)
				return;
			const { verifyRemoteReference } = await import("./remote.js");
			await verifyRemoteReference(ctx, readRemoteNoteReference(snapshot));
		},
		async executeRemoteAttachment(ctx, snapshot, request, signal) {
			if (request.namespace === "history")
				throw new Error(
					"History is unavailable from a saved remote notes attachment. Open its saved Pi JSONL session on this machine, then retry.",
				);
			const { executeRemoteAttachment } = await import("./remote.js");
			return executeRemoteAttachment(
				ctx,
				readRemoteNoteReference(snapshot),
				request,
				signal,
			);
		},
		parseAttachmentNotes(input, identity) {
			if (!Array.isArray(input))
				throw new Error("Invalid persisted checkpoint entries");
			const entries: SessionEntry[] = input.map((entry: unknown) => {
				if (
					!entry ||
					typeof entry !== "object" ||
					!("type" in entry) ||
					!(
						(entry.type === "custom" &&
							"customType" in entry &&
							typeof entry.customType === "string" &&
							"data" in entry) ||
						(entry.type === "branch_summary" && "details" in entry)
					)
				)
					throw new Error("Invalid persisted checkpoint entry");
				return entry as SessionEntry;
			});
			const snapshot = exportNotesSnapshot(entries, identity.agentName);
			return {
				...snapshot,
				files: snapshot.files.filter(
					(file) =>
						contextTargetAgent(
							"notes",
							{ path: file.path },
							identity.agentName,
						) === identity.agentName,
				),
			};
		},
		readAttachmentNotes(snapshot, params) {
			const details = readAttachmentSnapshot(snapshot, params);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details: { codexHistoryNotes: details },
			};
		},
	} satisfies Pick<
		ContextSharingService,
		| "exportAttachmentNotes"
		| "validateAttachmentNotes"
		| "verifyAttachmentAccess"
		| "executeRemoteAttachment"
		| "parseAttachmentNotes"
		| "readAttachmentNotes"
	>;
}
