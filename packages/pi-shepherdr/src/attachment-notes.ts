import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	ContextAgentIdentity,
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-agent-comms/context-sharing";
import { NOTES_UNAVAILABLE } from "./notes-discovery.js";

/** Read-only continuity when a live owner disappears. Notes owns parsing. */
export class AttachmentNotes {
	private readonly getService: () => ContextSharingService | undefined;
	constructor(getService: () => ContextSharingService | undefined) {
		this.getService = getService;
	}
	private service() {
		const service = this.getService();
		if (
			!service?.exportAttachmentNotes ||
			!service.parseAttachmentNotes ||
			!service.readAttachmentNotes
		)
			throw new Error(NOTES_UNAVAILABLE);
		return {
			export: service.exportAttachmentNotes,
			parse: service.parseAttachmentNotes,
			read: service.readAttachmentNotes,
			validate: service.validateAttachmentNotes,
			verify: service.verifyAttachmentAccess,
			remote: service.executeRemoteAttachment,
		};
	}
	export(ctx: ExtensionContext) {
		return this.service().export(ctx);
	}
	validate(snapshot: unknown, identity: ContextAgentIdentity) {
		const service = this.service();
		if (service.validate) return service.validate(snapshot, identity);
		if (identity.storage === "remote")
			throw new Error("Update Codex Conversion to retain Remote checkpoints");
		this.service().read(snapshot, {
			action: "list_files_by_prefix",
			prefix: `${identity.agentName}/notes`,
		});
	}
	async verify(
		ctx: ExtensionContext,
		snapshot: unknown,
		identity: ContextAgentIdentity,
		alreadyShared = false,
	) {
		this.validate(snapshot, identity);
		if (identity.storage === "remote") {
			const verify = this.service().verify;
			if (!verify)
				throw new Error(
					"Update Codex Conversion to authenticate Remote attachments",
				);
			try {
				await verify(ctx, snapshot);
			} catch (error) {
				if (
					!alreadyShared &&
					error instanceof Error &&
					error.message.startsWith("Account mismatch.")
				)
					throw new Error(
						"Account mismatch. No context shared; each agent keeps its Notes and history. Exchange needed context by message.",
						{ cause: error },
					);
				throw error;
			}
		}
	}
	async remote(
		ctx: ExtensionContext,
		reference: unknown,
		request: SharedContextRequest,
		signal?: AbortSignal,
	) {
		const execute = this.service().remote;
		if (!execute)
			throw new Error(
				"Update Codex Conversion to read attached Remote context",
			);
		return execute(ctx, reference, request, signal);
	}
	checkTransport(value: unknown) {
		if (Buffer.byteLength(JSON.stringify(value), "utf8") > 7 * 1024 * 1024)
			throw new Error(
				"Checkpoints exceed transport limit. No attach or detach committed",
			);
	}
	canRead(request: SharedContextRequest) {
		return (
			request.namespace === "notes" &&
			["read_file", "list_files_by_prefix", "search_contents"].includes(
				String(request.params["action"]),
			)
		);
	}
	async read(
		request: SharedContextRequest,
		identity: ContextAgentIdentity,
		retained: unknown,
		detached: boolean,
		persisted: () => Promise<unknown>,
		liveError?: unknown,
	): Promise<SharedContextResult> {
		if (request.namespace !== "notes")
			throw new Error(
				"Counterpart history needs its live attached owner. Native history unchanged",
			);
		if (
			!["read_file", "list_files_by_prefix", "search_contents"].includes(
				String(request.params["action"]),
			)
		)
			throw new Error(
				"Read-only checkpoints. Resume the attached owner to write notes",
			);
		let snapshot = retained;
		let source = "retained-checkpoints";
		let unavailable: string | undefined;
		let savedAt: number | undefined;
		if (!detached) {
			try {
				const result = await persisted();
				if (
					!result ||
					typeof result !== "object" ||
					!("entries" in result) ||
					!("savedAt" in result) ||
					typeof result.savedAt !== "number"
				)
					throw new Error("Invalid persisted checkpoint response");
				snapshot = this.service().parse(result.entries, identity);
				savedAt = result.savedAt;
				source = "persisted-owner-checkpoints";
			} catch (error) {
				unavailable = String(error);
			}
		}
		if (
			!snapshot ||
			typeof snapshot !== "object" ||
			!("timestamp" in snapshot) ||
			typeof snapshot.timestamp !== "number"
		)
			throw new Error("Invalid retained checkpoint timestamp");
		const details = {
			source,
			read_only: true,
			captured_at:
				new Date(snapshot.timestamp).toISOString().slice(0, 16) + "Z",
			...(savedAt === undefined
				? {}
				: { saved_at: new Date(savedAt).toISOString().slice(0, 16) + "Z" }),
			...(detached
				? { detached: true }
				: {
						live_unavailable: String(liveError),
						...(unavailable
							? { persisted_unavailable: unavailable, stale: true }
							: {}),
					}),
		};
		const warning = `Read-only checkpoints captured ${details.captured_at}.${
			detached
				? " Counterpart detached."
				: unavailable
					? " Live owner and saved updates unavailable. May be stale; resume the counterpart for current notes."
					: " Live owner unavailable."
		}`;
		const result = this.service().read(snapshot, request.params, {
			read_only: true,
			captured_at: details.captured_at,
			...(savedAt === undefined ? {} : { saved_at: details.saved_at }),
			warning,
		});
		if (
			!result.details.codexHistoryNotes ||
			typeof result.details.codexHistoryNotes !== "object" ||
			!("warning" in result.details.codexHistoryNotes) ||
			result.details.codexHistoryNotes["warning"] !== warning
		)
			throw new Error("Update Notes to read retained attached checkpoints");
		return {
			...result,
			details: {
				...result.details,
				codexHistoryNotes: { ...result.details.codexHistoryNotes, ...details },
			},
		};
	}
}
