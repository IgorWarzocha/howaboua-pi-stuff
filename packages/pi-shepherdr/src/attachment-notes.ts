import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	ContextAgentIdentity,
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-codex-conversion/context-sharing";

/** Read-only continuity when a live owner disappears. Parsing remains Conversion-owned. */
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
			throw new Error("Update Codex Conversion to retain attached checkpoints");
		return {
			export: service.exportAttachmentNotes,
			parse: service.parseAttachmentNotes,
			read: service.readAttachmentNotes,
		};
	}
	export(ctx: ExtensionContext) {
		return this.service().export(ctx);
	}
	validate(snapshot: unknown, identity: ContextAgentIdentity) {
		this.service().read(snapshot, {
			action: "list_files_by_prefix",
			prefix: `${identity.agentName}/notes`,
		});
	}
	checkTransport(value: unknown) {
		if (Buffer.byteLength(JSON.stringify(value), "utf8") > 7 * 1024 * 1024)
			throw new Error(
				"Attached checkpoints exceed the transport limit; attachment or detach was not committed",
			);
	}
	unavailable(error: unknown) {
		return (
			error instanceof Error &&
			/^(Shared context (?:owner|controller) is unavailable|Shared context response was lost|Herdr machine .* is (?:unavailable|disconnected)|remote Shepherdr bridge is unavailable|remote Shepherdr context timed out)/.test(
				error.message,
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
				"Counterpart history requires its live attached owner; native history is unchanged",
			);
		if (
			!["read_file", "list_files_by_prefix", "search_contents"].includes(
				String(request.params["action"]),
			)
		)
			throw new Error(
				"Retained checkpoints are read-only; resume the attached owner to write notes",
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
		const result = this.service().read(snapshot, request.params);
		if (
			!snapshot ||
			typeof snapshot !== "object" ||
			!("timestamp" in snapshot) ||
			typeof snapshot.timestamp !== "number"
		)
			throw new Error("Invalid retained checkpoint timestamp");
		const details = {
			...result.details.codexHistoryNotes,
			source,
			read_only: true,
			captured_at: new Date(snapshot.timestamp).toISOString(),
			...(savedAt === undefined
				? {}
				: { saved_at: new Date(savedAt).toISOString() }),
			...(detached
				? { detached: true }
				: {
						live_unavailable: String(liveError),
						...(unavailable
							? { persisted_unavailable: unavailable, stale: true }
							: {}),
					}),
		};
		return {
			content: [{ type: "text", text: JSON.stringify(details) }],
			details: { codexHistoryNotes: details },
		};
	}
}
