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
import { visibleWidth } from "@earendil-works/pi-tui";

const reaction = obj({
	id: str({ pattern: "^[a-zA-Z0-9_-]+$" }),
	icon: str(),
	label: str(),
	startTurn: opt(bool()),
});

export type Reaction = Static<typeof reaction>;

const reactionConfig = compile(arr(reaction));
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

function parseConfig(source: string): Reaction[] {
	const value: unknown = JSON.parse(source);
	if (!reactionConfig.check(value)) {
		throw new Error(
			"Expected reactions with id, icon, label and optional boolean startTurn. IDs use letters, digits, underscores or hyphens.",
		);
	}
	const ids = new Set<string>();
	const icons = new Set<string>();
	const segmenter = new Intl.Segmenter();
	for (const { id, icon, label } of value) {
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
	}
	return value;
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
