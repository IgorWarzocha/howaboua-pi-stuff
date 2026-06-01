import { Input } from "@earendil-works/pi-tui";

const MAX_PARTS = 4;

function normalizePart(part: string) {
	return part.trim().toLowerCase();
}

export function parseChord(raw: string): string[] {
	return raw.split("+").map(normalizePart).filter(Boolean).slice(0, MAX_PARTS);
}

export function formatChord(parts: string[]) {
	return parts.map(normalizePart).filter(Boolean).join("+");
}

export function isValidChord(chord: string): boolean {
	const parts = parseChord(chord);
	if (parts.length === 0 || parts.length > MAX_PARTS) return false;
	return parts.every((p) => /^[a-z0-9]+$/.test(p));
}

export function createShortcutCaptureSubmenu(
	initial: string,
	onDone: (value?: string) => void,
) {
	const input = new Input();
	input.setValue(initial);
	let parts = parseChord(initial);

	const flush = () => {
		const chord = formatChord(parts);
		if (!isValidChord(chord)) return;
		onDone(chord);
	};

	input.onSubmit = () => flush();
	input.onEscape = () => onDone(undefined);

	return {
		invalidate: () => input.invalidate?.(),
		render: (width: number) => {
			const lines = input.render(width);
			const preview = formatChord(parts) || "(empty)";
			lines.push("");
			lines.push(`  Recording: ${preview}`);
			lines.push("  Type keys, + adds chord · Enter save · Esc cancel");
			return lines;
		},
		handleInput: (data: string) => {
			if (data === "\x1b" || data === "\x7f") {
				onDone(undefined);
				return;
			}
			if (data === "+" || data === "=") {
				const tail = parts[parts.length - 1];
				if (tail && parts.length < MAX_PARTS) {
					parts = [...parts, ""];
					input.setValue(formatChord(parts));
				}
				return;
			}
			input.handleInput(data);
			parts = parseChord(input.getValue());
		},
	};
}
