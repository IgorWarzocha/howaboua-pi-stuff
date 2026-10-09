import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Display-only Pi activity. It never adds voice context or model input. */
export class PiActivity {
	private busy = false;
	private text = "";
	private prompts: { title?: string }[] = [];
	private status: "idle" | "working" | "settled" = "idle";
	onChange: (() => void) | undefined;
	snapshot(): {
		status: "idle" | "working" | "waiting" | "settled";
		text: string;
		prompt?: string;
	} {
		const prompt = this.prompts.at(-1);
		return {
			status: prompt ? "waiting" : this.status,
			text: this.text,
			...(prompt
				? {
						prompt:
							prompt.title ?? "Pi is waiting for your input in the terminal",
					}
				: {}),
		};
	}
	working(): void {
		if (!this.busy) this.text = "";
		this.busy = true;
		this.status = "working";
		this.onChange?.();
	}
	message(message: AssistantMessage): void {
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		if (text.trim()) this.text = text;
		this.onChange?.();
	}
	waiting(title?: string): void {
		this.prompts.push(title === undefined ? {} : { title });
		this.onChange?.();
	}
	promptEnded(): void {
		this.prompts.pop();
		this.onChange?.();
	}
	settled(): void {
		this.busy = false;
		this.status = this.text ? "settled" : "idle";
		this.onChange?.();
	}
	reset(): void {
		this.busy = false;
		this.status = "idle";
		this.text = "";
		this.prompts = [];
		this.onChange?.();
	}
}
