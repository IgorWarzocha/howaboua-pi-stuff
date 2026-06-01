import { Input } from "@earendil-works/pi-tui";
import { DEFAULT_SHORTCUTS } from "../constants.js";

const MAX_PARTS = 4;

function normalizePart(part: string) {
	return part.trim().toLowerCase();
}

export function parseChord(raw: string | undefined): string[] {
	const text = typeof raw === "string" ? raw : "";
	return text.split("+").map(normalizePart).filter(Boolean).slice(0, MAX_PARTS);
}

export function formatChord(parts: string[]) {
	return parts.map(normalizePart).filter(Boolean).join("+");
}

export function isValidChord(chord: string | undefined): boolean {
	if (typeof chord !== "string") return false;
	const parts = parseChord(chord);
	if (parts.length === 0 || parts.length > MAX_PARTS) return false;
	return parts.every((p) => /^[a-z0-9]+$/.test(p));
}

export function createShortcutCaptureSubmenu(
	initial: string | undefined,
	onDone: (value?: string) => void,
) {
	const input = new Input();
	const seed =
		typeof initial === "string" && initial.trim() ? initial.trim() : "alt+z";
	input.setValue(seed);
	let parts = parseChord(seed);

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

export function defaultShortcut(id: keyof typeof DEFAULT_SHORTCUTS): string {
	return DEFAULT_SHORTCUTS[id];
}

export const SHORTCUT_CONFIG_KEYS = {
	composeShortcut: "compose",
	injectShortcut: "inject",
	dismissShortcut: "clear",
	foldShortcut: "fold",
	unfoldShortcut: "unfold",
	previousShortcut: "previous",
	nextShortcut: "next",
} as const;

export type ShortcutConfigField = keyof typeof SHORTCUT_CONFIG_KEYS;

export function resolveShortcutChord(
	field: ShortcutConfigField,
	value: string | undefined,
): string {
	const chord = typeof value === "string" && value.trim() ? value.trim() : "";
	if (isValidChord(chord)) return chord;
	return defaultShortcut(SHORTCUT_CONFIG_KEYS[field]);
}
