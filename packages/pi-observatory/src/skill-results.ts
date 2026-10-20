import { posix } from "node:path";
import { object } from "./normalise.ts";

export interface RecoveredSkillReads {
	paths: string[];
	roots: { path: string; name?: string }[];
	continuation: boolean;
	unsupported: boolean;
}

const MAX_TEXT = 262_144;
const MAX_PATHS = 512;
const MAX_PATH = 8_192;

interface Footer {
	kind: "inventory" | "sources";
	start: number;
	end: number;
	paths: string[];
}

function pathValue(value: string): string | undefined {
	const path = value.replaceAll("\\", "/");
	if (
		path.length > MAX_PATH ||
		/[\0\r\n]/.test(path) ||
		!/^(?:\/|~\/|[A-Za-z]:\/)/.test(path)
	)
		return undefined;
	return posix.normalize(path);
}

function rootPath(path: string): string | undefined {
	if (posix.basename(path).toLowerCase() === "skill.md") return path;
	const marker = path.lastIndexOf("/references/");
	return marker > 0 ? `${path.slice(0, marker)}/SKILL.md` : undefined;
}

function aliases(path: string): string[] {
	const root = rootPath(path);
	if (!root) return [];
	const name = posix.basename(posix.dirname(root));
	if (root === path) return [path, name, `${name}.md`, `${name}/SKILL.md`];
	const reference = path.slice(posix.dirname(root).length + 12);
	return [
		path,
		`${name}/references/${reference}`,
		`references/${reference}`,
		reference,
	].flatMap((value) => [value, value.replace(/\.md$/i, "")]);
}

function request(input: unknown): unknown {
	if (typeof input === "string" && input.trimStart().startsWith("{")) {
		try {
			return JSON.parse(input);
		} catch {
			return input;
		}
	}
	return input;
}

function commandText(input: unknown): string | undefined {
	const value = request(input);
	if (value == null) return "";
	if (typeof value === "string") return value;
	const args = object(value);
	if (typeof args["command"] === "string") return args["command"];
	if (!Object.keys(args).length) return "";
	// Recorded early Skills calls used JSON-string action/name requests.
	if (args["action"] === "list" || args["action"] === "help")
		return args["action"];
	if (args["action"] === "read" && typeof args["name"] === "string")
		return `read ${args["name"]}`;
	return undefined;
}

function selectedPaths(
	groups: string[][],
	available: string[],
): { paths: Set<string>; unsupported: boolean } {
	const paths = new Set<string>();
	let unsupported = false;
	for (const tokens of groups) {
		let currentRoot: string | undefined;
		const selected: string[] = [];
		const unresolved: number[] = [];
		for (const [index, token] of tokens.entries()) {
			// Own SKILL.md selectors are ignored by the reader.
			if (token === "SKILL.md" && currentRoot) continue;
			const matches = available.filter((path) => aliases(path).includes(token));
			const bodies = matches.filter((path) => rootPath(path) === path);
			const local = matches.filter((path) => rootPath(path) === currentRoot);
			const candidates = bodies.length
				? bodies
				: local.length
					? local
					: matches;
			if (candidates.length !== 1) {
				unresolved.push(index);
				continue;
			}
			const path = candidates[0];
			if (!path) continue;
			if (index > 0 && path === currentRoot) continue;
			selected.push(path);
			currentRoot = rootPath(path);
		}
		// An omitted primary skill need not have a path anywhere in reference-only output.
		const omittedPrimary =
			unresolved.length === 1 &&
			unresolved[0] === 0 &&
			selected.length > 0 &&
			selected.every((path) => rootPath(path) !== path);
		unsupported ||=
			!tokens.length || (unresolved.length > 0 && !omittedPrimary);
		const first = selected[0];
		// Both historical readers omit the primary body for reference-only selectors.
		if (
			first &&
			rootPath(first) === first &&
			selected.length > 1 &&
			selected.slice(1).every((path) => rootPath(path) !== path)
		)
			selected.shift();
		for (const path of selected) paths.add(path);
	}
	return { paths, unsupported };
}

function bodyPaths(body: string, candidates: string[]): string[] {
	const headings = [...body.matchAll(/^--- ([^\n]+) ---\n/gm)];
	if (!headings.length)
		return candidates.length === 1 && body.trim() ? candidates : [];
	const paths: string[] = [];
	for (const [index, heading] of headings.entries()) {
		const label = heading[1] ?? "";
		const content = body.slice(
			heading.index + heading[0].length,
			headings[index + 1]?.index ?? body.length,
		);
		if (!content.trim()) continue;
		const matched = candidates.filter((path) => aliases(path).includes(label));
		if (matched.length === 1 && matched[0]) paths.push(matched[0]);
	}
	return paths;
}

/** Historical output evidence, not receipts. The caller owns outcome and skill-location policy. */
export function recoverSkillReads(
	tool: string,
	args: unknown,
	result: unknown,
): RecoveredSkillReads {
	const recovered: RecoveredSkillReads = {
		paths: [],
		roots: [],
		continuation: false,
		unsupported: false,
	};
	if (tool !== "skills" && tool !== "more_skills") return recovered;
	const command = commandText(args);
	if (command === undefined || command.length > MAX_PATH) {
		recovered.unsupported = true;
		return recovered;
	}
	const offset = /\s+--offset\s+(\d+)\s*$/.exec(command);
	recovered.continuation = Boolean(offset && Number(offset[1]) > 0);
	const groups = (offset ? command.slice(0, offset.index) : command)
		.split(";")
		.map((group) => group.trim().split(/\s+/).filter(Boolean));
	const reads = groups
		.filter((group) => group[0] === "read")
		.map((group) => group.slice(1));
	if (!reads.length) {
		recovered.unsupported = groups.some(
			(group) => group.length > 0 && !["help", "list"].includes(group[0] ?? ""),
		);
		return recovered;
	}
	const envelope = object(result);
	if (envelope["isError"] === true || envelope["error"]) return recovered;
	const content = envelope["content"];
	let text = "";
	if (typeof content === "string") text = content;
	else if (Array.isArray(content) && content.length <= MAX_PATHS) {
		for (const item of content) {
			const part = object(item);
			if (part["type"] !== "text" || typeof part["text"] !== "string") continue;
			if (text.length + part["text"].length > MAX_TEXT) {
				recovered.unsupported = true;
				return recovered;
			}
			text += `${text ? "\n" : ""}${part["text"]}`;
		}
	}
	if (!text || text.length > MAX_TEXT || recovered.continuation) {
		recovered.unsupported = true;
		return recovered;
	}
	text = text.replaceAll("\r\n", "\n");
	const footers: Footer[] = [];
	const available = new Set<string>();
	for (const match of text.matchAll(
		/^---\n(?:Skill paths \((\d+)\):|Sources:)\n((?:- [^\n]+(?:\n|$))+)/gm,
	)) {
		const values = (match[2] ?? "").trimEnd().split("\n");
		if (
			values.length > MAX_PATHS ||
			available.size + values.length > MAX_PATHS
		) {
			recovered.unsupported = true;
			break;
		}
		const paths = values.map((line) => pathValue(line.slice(2)));
		if (
			paths.some((path) => !path) ||
			(match[1] && Number(match[1]) !== paths.length)
		) {
			recovered.unsupported = true;
			continue;
		}
		const valid = paths.filter((path): path is string => Boolean(path));
		footers.push({
			kind: match[1] ? "inventory" : "sources",
			start: match.index,
			end: match.index + match[0].length,
			paths: valid,
		});
		for (const path of valid) {
			if (rootPath(path)) available.add(path);
			const root = rootPath(path);
			if (root) available.add(root);
		}
	}
	const roots = [...available].filter((path) => rootPath(path) === path);
	recovered.roots = roots.map((path) => ({ path }));
	const selected = selectedPaths(reads, [...available]);
	recovered.unsupported ||= selected.unsupported;
	const proven = new Set<string>();
	let start = 0;
	let sourcesStart = 0;
	for (const footer of footers) {
		const body = text.slice(start, footer.start);
		const candidates = footer.paths.filter((path) => selected.paths.has(path));
		if (footer.kind === "inventory") {
			for (const path of bodyPaths(body, candidates)) proven.add(path);
		} else {
			// Sources lists emitted reference bodies, unlike the package inventory.
			// A preceding command may have headings while this command has one unheaded body.
			for (const path of bodyPaths(body, candidates)) proven.add(path);
			const bodies = text
				.slice(sourcesStart, footer.start)
				.replace(/^---\nSkill paths \(\d+\):\n(?:- [^\n]+(?:\n|$))+/gm, "");
			for (const path of bodyPaths(bodies, candidates)) proven.add(path);
			sourcesStart = footer.end;
		}
		start = footer.end;
	}
	recovered.paths = [...proven];
	recovered.unsupported ||=
		!footers.length ||
		[...selected.paths].some((path) => !proven.has(path)) ||
		/\[(?:Trace output|Index text|Index detail) truncated\]|^Incomplete: bytes /m.test(
			text,
		);
	return recovered;
}
