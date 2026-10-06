import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./review.js";

const BASENAME = "pi-codex-guardian.json";

const DEFAULT_REVIEW = {
	execution: true,
	fileChanges: true,
	readOnly: false,
	otherTools: true,
};
type ReviewScope = typeof DEFAULT_REVIEW;

export type ScopePolicy =
	| {
			valid: true;
			review: ReviewScope;
			source: "default" | "global" | "repo";
			cwd: string;
	  }
	| { valid: false; error: string };

function readScope(path: string): Partial<ReviewScope> | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return;
		throw new Error(`Cannot read ${path}`);
	}
	if (Buffer.byteLength(text, "utf8") > 64 * 1024)
		throw new Error(`${path} exceeds 64 KiB`);
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`Invalid JSON in ${path}`);
	}
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => key !== "review") ||
		!isRecord(value["review"]) ||
		Object.entries(value["review"]).some(
			([key, enabled]) =>
				!Object.hasOwn(DEFAULT_REVIEW, key) || typeof enabled !== "boolean",
		)
	)
		throw new Error(
			`${path} must contain review with boolean execution, fileChanges, readOnly or otherTools settings`,
		);
	const result: Partial<ReviewScope> = {};
	for (const key of [
		"execution",
		"fileChanges",
		"readOnly",
		"otherTools",
	] as const) {
		const enabled = value["review"][key];
		if (typeof enabled === "boolean") result[key] = enabled;
	}
	return result;
}

/** Snapshot only at session start or explicit user reload, never from a tool call. */
export function loadScope(cwd: string, projectTrusted: boolean): ScopePolicy {
	try {
		const global = readScope(join(getAgentDir(), BASENAME));
		const repo = projectTrusted
			? readScope(join(cwd, ".pi", BASENAME))
			: undefined;
		return {
			valid: true,
			review: { ...DEFAULT_REVIEW, ...global, ...repo },
			source:
				repo !== undefined
					? "repo"
					: global !== undefined
						? "global"
						: "default",
			cwd,
		};
	} catch (error) {
		return {
			valid: false,
			error:
				error instanceof Error ? error.message : "Review policy unavailable",
		};
	}
}

/** Unknown/custom tools remain reviewed. No shell parsing or name-prefix safety guesses. */
export function requiresReview(toolName: string, scope: ReviewScope): boolean {
	switch (toolName) {
		case "bash":
		case "powershell":
		case "exec_command":
		case "write_stdin":
		case "exec":
		case "wait":
		case "notebook":
			return scope.execution;
		case "write":
		case "edit":
		case "apply_patch":
			return scope.fileChanges;
		case "read":
		case "ls":
		case "find":
		case "grep":
		case "view_image":
			return scope.readOnly;
		default:
			return scope.otherTools;
	}
}
