import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const REALTIME_SYSTEM_PROMPT_BASENAME = "REALTIME-SYSTEM-PROMPT.md";
const REALTIME_SYSTEM_PROMPT_CHANGELOG_BASENAME = "REALTIME-SYSTEM-PROMPT-CHANGELOG.md";

const CODEX_VOICE_PROMPT_VERSION_PATTERN = /^\ufeff?<!-- codex-voice-prompt-version: (\d+) -->[ \t]*\r?$/gm;
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PACKAGED_VOICE_DIR = join(PACKAGE_ROOT, "src", "voice");
const CONNECTED_PI_RUNTIME_CONTRACT = `## Connected Pi runtime

You have a connected Pi agent with the active session's tools and environment. Delegate every request that needs facts, reasoning, current or external state, or any action. This includes questions about the current time or date, machine, network, working directory, files, project, and session. Respond directly only to greetings, acknowledgements, and casual social conversation that needs no facts or work. Never claim tools or host access are unavailable; delegate and use Pi's result.`;

export interface CodexVoiceSystemPromptStatus {
	created: boolean;
	schemaVersion?: number;
	currentSchemaVersion: number;
	current: boolean;
}

export function getCodexVoiceSystemPromptPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, REALTIME_SYSTEM_PROMPT_BASENAME);
}

export function getProjectCodexVoiceSystemPromptPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, REALTIME_SYSTEM_PROMPT_BASENAME);
}

export function getPackagedCodexVoiceSystemPromptPath(): string {
	return join(PACKAGED_VOICE_DIR, REALTIME_SYSTEM_PROMPT_BASENAME);
}

export function getCodexVoiceSystemPromptChangelogPath(): string {
	return join(PACKAGED_VOICE_DIR, REALTIME_SYSTEM_PROMPT_CHANGELOG_BASENAME);
}

export function prepareCodexVoiceSystemPrompt(
	promptPath: string = getCodexVoiceSystemPromptPath(),
	templatePath: string = getPackagedCodexVoiceSystemPromptPath(),
): CodexVoiceSystemPromptStatus {
	let created = false;
	const template = readFileSync(templatePath, "utf8");
	const currentSchemaVersion = readCodexVoicePromptSchemaVersion(template);
	if (currentSchemaVersion === undefined) throw new Error(`Packaged Codex voice prompt at ${templatePath} must contain exactly one valid schema marker`);
	mkdirSync(dirname(promptPath), { recursive: true });
	try {
		writeFileSync(promptPath, template, { encoding: "utf8", flag: "wx", mode: 0o600 });
		created = true;
	} catch (error) {
		if (!isAlreadyExistsError(error)) throw error;
	}
	const schemaVersion = readCodexVoicePromptSchemaVersion(readFileSync(promptPath, "utf8"));
	return {
		created,
		...(schemaVersion === undefined ? {} : { schemaVersion }),
		currentSchemaVersion,
		current: schemaVersion === currentSchemaVersion,
	};
}

export function formatCodexVoicePromptSchemaMismatch(
	currentSchemaVersion: number,
	promptPath: string = getCodexVoiceSystemPromptPath(),
	changelogPath: string = getCodexVoiceSystemPromptChangelogPath(),
): string {
	return [
		"Realtime system prompt schema mismatch.",
		`Please ask your agent to read ${changelogPath} and migrate ${promptPath} to schema ${currentSchemaVersion}, while preserving your personal configuration.`,
		"This extension does not do this automatically to preserve your customisations.",
	].join("\n");
}

export function loadCodexVoiceSystemPrompt(
	promptPath: string = getCodexVoiceSystemPromptPath(),
	projectPromptPath?: string,
): string {
	const prompt = readVoicePrompt(promptPath)!;
	if (!projectPromptPath) return `${prompt}\n\n${CONNECTED_PI_RUNTIME_CONTRACT}`;
	const projectPrompt = readVoicePrompt(projectPromptPath, true);
	const customized = projectPrompt ? `${prompt}\n\n# Project level instructions\n\n${projectPrompt}` : prompt;
	return `${customized}\n\n${CONNECTED_PI_RUNTIME_CONTRACT}`;
}

function readCodexVoicePromptSchemaVersion(source: string): number | undefined {
	const matches = [...source.matchAll(CODEX_VOICE_PROMPT_VERSION_PATTERN)];
	if (matches.length !== 1) return undefined;
	const version = Number(matches[0]?.[1]);
	return Number.isSafeInteger(version) ? version : undefined;
}

function readVoicePrompt(promptPath: string, optional = false): string | undefined {
	let source: string;
	try {
		source = readFileSync(promptPath, "utf8");
	} catch (error) {
		if (optional && isNotFoundError(error)) return undefined;
		throw new Error(`Could not read Codex voice prompt at ${promptPath}: ${errorMessage(error)}`);
	}
	let prompt: string;
	try {
		prompt = stripMarkdownComments(source);
	} catch (error) {
		throw new Error(`Invalid Codex voice prompt at ${promptPath}: ${errorMessage(error)}`);
	}
	return prompt;
}

function stripMarkdownComments(source: string): string {
	let output = "";
	let cursor = 0;
	while (cursor < source.length) {
		const opening = source.indexOf("<!--", cursor);
		const strayClosing = source.indexOf("-->", cursor);
		if (strayClosing !== -1 && (opening === -1 || strayClosing < opening)) {
			throw new Error("Codex voice prompt contains an unmatched Markdown comment close");
		}
		if (opening === -1) {
			output += source.slice(cursor);
			break;
		}
		output += source.slice(cursor, opening);
		const closing = source.indexOf("-->", opening + 4);
		if (closing === -1) throw new Error("Codex voice prompt contains an unclosed Markdown comment");
		cursor = closing + 3;
	}
	return output.replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isAlreadyExistsError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
