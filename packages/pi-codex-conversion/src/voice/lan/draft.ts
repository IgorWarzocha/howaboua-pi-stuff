const MAX_LAN_VOICE_DRAFT_BYTES = 64 * 1024;

export interface LanVoiceDraftSelection {
	start: number;
	end: number;
}

export class LanVoiceDraftError extends Error {}
export class LanVoiceDraftConflictError extends LanVoiceDraftError {}

export class LanVoiceDraft {
	private readonly publish: (message: unknown) => void;
	private readonly sendMessage: (text: string) => void | Promise<void>;
	private text = "";
	private revision = 0;
	private sending = false;

	constructor(options: {
		publish(message: unknown): void;
		sendMessage(text: string): void | Promise<void>;
	}) {
		this.publish = options.publish;
		this.sendMessage = options.sendMessage;
	}

	snapshot(sourceClientId?: string, reason?: "update" | "transcript" | "sent"): { type: "draft"; text: string; revision: number; sourceClientId?: string; reason?: string } {
		return {
			type: "draft",
			text: this.text,
			revision: this.revision,
			...(sourceClientId ? { sourceClientId } : {}),
			...(reason ? { reason } : {}),
		};
	}

	update(clientId: string, value: unknown, expectedRevision: unknown): number {
		this.assertRevision(expectedRevision);
		this.text = validatedDraft(value);
		this.revision += 1;
		this.publish(this.snapshot(clientId, "update"));
		return this.revision;
	}

	insertTranscript(clientId: string, transcript: string, selection?: LanVoiceDraftSelection): void {
		const clean = transcript.trim();
		if (!clean) return;
		const start = boundedIndex(selection?.start, this.text.length, this.text.length);
		const end = boundedIndex(selection?.end, this.text.length, start);
		const before = this.text.slice(0, Math.min(start, end));
		const after = this.text.slice(Math.max(start, end));
		const leftSpace = before && !/\s$/.test(before) ? " " : "";
		const rightSpace = after && !/^\s/.test(after) ? " " : "";
		this.text = validatedDraft(`${before}${leftSpace}${clean}${rightSpace}${after}`);
		this.revision += 1;
		this.publish(this.snapshot(clientId, "transcript"));
	}

	async send(clientId: string, value: unknown, expectedRevision: unknown): Promise<void> {
		this.assertRevision(expectedRevision);
		if (this.sending) throw new LanVoiceDraftConflictError("A message is already being sent");
		const text = validatedDraft(value);
		if (!text.trim()) throw new LanVoiceDraftError("A message is required");
		this.text = text;
		const revision = this.revision;
		this.sending = true;
		try {
			await this.sendMessage(text);
		} finally {
			this.sending = false;
		}
		if (this.revision === revision && this.text === text) this.text = "";
		this.revision += 1;
		this.publish({ type: "sent" });
		this.publish(this.snapshot(clientId, "sent"));
	}

	private assertRevision(value: unknown): void {
		if (!Number.isInteger(value) || value !== this.revision) throw new LanVoiceDraftConflictError("Draft changed on another device; review it and try again");
	}
}

function validatedDraft(value: unknown): string {
	if (typeof value !== "string") throw new LanVoiceDraftError("Draft text is required");
	if (Buffer.byteLength(value) > MAX_LAN_VOICE_DRAFT_BYTES) throw new LanVoiceDraftError("Draft is too large");
	return value;
}

function boundedIndex(value: number | undefined, length: number, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= length ? value : fallback;
}
