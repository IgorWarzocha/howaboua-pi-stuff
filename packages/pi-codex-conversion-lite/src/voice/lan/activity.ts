const MAX_ACTIVITY_BYTES = 16 * 1024;

export type LanVoiceActivityMessage =
	| { type: "activity"; state: "idle" | "working" }
	| { type: "activity"; state: "settled"; text: string };

export class LanVoiceActivity {
	private readonly publish: (message: LanVoiceActivityMessage) => void;
	private state: LanVoiceActivityMessage;

	constructor(options: {
		initialWorking: boolean;
		publish(message: LanVoiceActivityMessage): void;
	}) {
		this.publish = options.publish;
		this.state = { type: "activity", state: options.initialWorking ? "working" : "idle" };
	}

	snapshot(): LanVoiceActivityMessage {
		return this.state;
	}

	working(): void {
		this.state = { type: "activity", state: "working" };
		this.publish(this.state);
	}

	settled(text?: string): void {
		const bounded = text ? truncateUtf8(text.trim(), MAX_ACTIVITY_BYTES) : "";
		this.state = bounded
			? { type: "activity", state: "settled", text: bounded }
			: { type: "activity", state: "idle" };
		this.publish(this.state);
	}
}

export function boundedAssistantText(parts: Array<{ type: string; text?: string | undefined }>): string | undefined {
	const text = parts.flatMap((part) => part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n").trim();
	return text ? truncateUtf8(text, MAX_ACTIVITY_BYTES) : undefined;
}

function truncateUtf8(value: string, maxBytes: number): string {
	const buffer = Buffer.from(value);
	if (buffer.byteLength <= maxBytes) return value;
	let end = maxBytes - Buffer.byteLength("…");
	while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
	return `${buffer.subarray(0, end).toString("utf8").trimEnd()}…`;
}
