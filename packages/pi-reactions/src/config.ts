import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	arr,
	bool,
	compile,
	obj,
	opt,
	str,
	type Static,
} from "@earendil-works/pi-schema";
import { Key, type KeyId, visibleWidth } from "@earendil-works/pi-tui";

const reaction = obj({
	id: str({ pattern: "^[a-zA-Z0-9_-]+$" }),
	icon: str(),
	label: str(),
	startTurn: opt(bool()),
	shortcut: opt(str()),
});

export type Reaction = Omit<Static<typeof reaction>, "shortcut"> & {
	shortcut?: KeyId;
};

const reactionConfig = compile(arr(reaction));
const shortcutModifiers = ["ctrl", "shift", "alt", "super"] as const;
const baseKeys = new Map(
	Object.values(Key)
		.filter((key) => typeof key === "string")
		.map((key) => [key.toLowerCase(), key]),
);
const defaults: readonly Reaction[] = [
	{ id: "like", icon: "👍", label: "OK" },
	{ id: "dislike", icon: "👎", label: "Reconsider" },
	{ id: "push", icon: "⬆️", label: "Push" },
	{ id: "verify", icon: "🔍", label: "Verify" },
];

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function readOrCreateConfig(directory: string, path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}

	const source = `${JSON.stringify(defaults, null, 2)}\n`;
	mkdirSync(directory, { recursive: true });
	try {
		writeFileSync(path, source, { flag: "wx" });
		return source;
	} catch (error) {
		if (!hasCode(error, "EEXIST")) throw error;
		return readFileSync(path, "utf8");
	}
}

function normalizeShortcut(value: string): KeyId | undefined {
	let key = value.trim().toLowerCase();
	const modifiers = new Set<(typeof shortcutModifiers)[number]>();
	while (true) {
		const modifier = shortcutModifiers.find((name) =>
			key.startsWith(`${name}+`),
		);
		if (!modifier) break;
		if (modifiers.has(modifier)) return undefined;
		modifiers.add(modifier);
		key = key.slice(modifier.length + 1);
	}
	const base =
		key === "esc"
			? Key.escape
			: key === "return"
				? Key.enter
				: /^[a-z0-9]$/u.test(key)
					? key
					: baseKeys.get(key);
	if (!base) return undefined;
	const hasModifier = [...modifiers].some((modifier) => modifier !== "shift");
	if (!hasModifier && !/^f(?:[1-9]|1[0-2])$/u.test(base)) return undefined;
	// The base comes from Pi's Key table (or a single ASCII letter/digit) and
	// every modifier is supported and unique.
	return [
		...shortcutModifiers.filter((modifier) => modifiers.has(modifier)),
		base,
	].join("+") as KeyId;
}

function parseConfig(source: string): Reaction[] {
	const value: unknown = JSON.parse(source);
	if (!reactionConfig.check(value)) {
		throw new Error(
			"Expected reactions with id, icon, label, optional boolean startTurn and optional string shortcut. IDs use letters, digits, underscores or hyphens.",
		);
	}
	const ids = new Set<string>();
	const icons = new Set<string>();
	const shortcuts = new Set<KeyId>();
	const segmenter = new Intl.Segmenter();
	return value.map(({ shortcut, ...reaction }) => {
		const { id, icon, label } = reaction;
		if (ids.has(id)) throw new Error(`Duplicate reaction ID: ${id}.`);
		if (
			[...segmenter.segment(icon)].length !== 1 ||
			/[\s\p{Cc}\p{Bidi_Control}]/u.test(icon) ||
			![1, 2].includes(visibleWidth(icon))
		) {
			throw new Error(`Reaction "${id}" needs one visible icon.`);
		}
		if (icons.has(icon))
			throw new Error(`Duplicate icon for reaction "${id}".`);
		if (!label.trim() || /[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/u.test(label)) {
			throw new Error(`Reaction "${id}" needs a non-empty, single-line label.`);
		}
		ids.add(id);
		icons.add(icon);
		if (shortcut === undefined) return reaction;
		const normalized = normalizeShortcut(shortcut);
		if (!normalized) {
			throw new Error(
				`Reaction "${id}" needs a Pi key chord with ctrl, alt or super, or a function key (F1–F12).`,
			);
		}
		if (shortcuts.has(normalized))
			throw new Error(`Duplicate reaction shortcut: ${normalized}.`);
		shortcuts.add(normalized);
		return { ...reaction, shortcut: normalized };
	});
}

export function loadReactions(): Reaction[] {
	const directory = getAgentDir();
	const path = join(directory, "reactions.json");
	try {
		return parseConfig(readOrCreateConfig(directory, path));
	} catch (error) {
		throw new Error(
			`Cannot load Pi Reactions settings at ${path}: ${error instanceof Error ? error.message : String(error)} Fix the file and run /reload.`,
			{ cause: error },
		);
	}
}
