import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Focusable,
	Input,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import { normalizeVoiceApiProvider } from "../config.ts";

export class ApiProviderPicker extends Container implements Focusable {
	private readonly input = new Input();
	constructor(value: string, back: (value?: string) => void, theme: Theme) {
		super();
		this.input.setValue(value);
		const error = new Text("", 0, 0);
		this.input.onSubmit = () => {
			const provider = normalizeVoiceApiProvider(this.input.getValue());
			if (provider) back(provider);
			else
				error.setText(
					theme.fg(
						"error",
						"Enter a name, at most 512 bytes, without surrounding whitespace or control characters.",
					),
				);
		};
		this.input.onEscape = () => back();
		this.addChild(new Text(theme.bold("API provider"), 0, 0));
		this.addChild(
			new Text(
				"Exact Pi provider name. Uses its API key and endpoint on the next Realtime call. Default: openai.",
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(this.input);
		this.addChild(error);
		this.addChild(
			new Text(theme.fg("dim", "Enter to save · Esc to cancel"), 0, 0),
		);
	}
	get focused() {
		return this.input.focused;
	}
	set focused(value: boolean) {
		this.input.focused = value;
	}
	handleInput(data: string) {
		this.input.handleInput(data);
	}
}
