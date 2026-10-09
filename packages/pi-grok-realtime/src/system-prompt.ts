import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { VOICE_PROMPT } from "./prompt.ts";

const BASENAME = "GROK-REALTIME-SYSTEM-PROMPT.md";

export function loadVoicePrompt(cwd: string, agentDir = getAgentDir()): string {
	const globalPath = join(agentDir, BASENAME);
	mkdirSync(agentDir, { recursive: true });
	try {
		writeFileSync(
			globalPath,
			readFileSync(new URL(`./${BASENAME}`, import.meta.url), "utf8"),
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
	} catch (error) {
		if (!hasCode(error, "EEXIST")) throw error;
	}
	const global = readInstructions(globalPath);
	const project = readInstructions(join(cwd, CONFIG_DIR_NAME, BASENAME), true);
	return [
		VOICE_PROMPT,
		global && `# User instructions\n\n${global}`,
		project && `# Project level instructions\n\n${project}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

function readInstructions(path: string, optional = false): string {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (optional && hasCode(error, "ENOENT")) return "";
		throw new Error(`Could not read Grok voice instructions at ${path}`, {
			cause: error,
		});
	}
	let output = "";
	let cursor = 0;
	while (cursor < source.length) {
		const opening = source.indexOf("<!--", cursor);
		const strayClosing = source.indexOf("-->", cursor);
		if (strayClosing !== -1 && (opening === -1 || strayClosing < opening))
			throw new Error(`Unmatched Markdown comment close in ${path}`);
		if (opening === -1) {
			output += source.slice(cursor);
			break;
		}
		output += source.slice(cursor, opening);
		const closing = source.indexOf("-->", opening + 4);
		if (closing === -1) throw new Error(`Unclosed Markdown comment in ${path}`);
		cursor = closing + 3;
	}
	return output
		.replace(/\n[ \t]+\n/g, "\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
