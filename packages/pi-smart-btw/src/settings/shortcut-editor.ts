import { DEFAULT_SHORTCUTS } from "../constants.js";

const MAX_PARTS = 4;

function normalizePart(part: string) {
	return part.trim().toLowerCase();
}

function parseChord(raw: string | undefined): string[] {
	const text = typeof raw === "string" ? raw : "";
	return text.split("+").map(normalizePart).filter(Boolean).slice(0, MAX_PARTS);
}

function isValidChord(chord: string | undefined): boolean {
	if (typeof chord !== "string") return false;
	const parts = parseChord(chord);
	if (parts.length === 0 || parts.length > MAX_PARTS) return false;
	return parts.every((p) => /^[a-z0-9]+$/.test(p));
}

function defaultShortcut(id: keyof typeof DEFAULT_SHORTCUTS): string {
	return DEFAULT_SHORTCUTS[id];
}

const SHORTCUT_CONFIG_KEYS = {
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
