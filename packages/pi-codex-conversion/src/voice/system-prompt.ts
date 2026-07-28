import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const REALTIME_SYSTEM_PROMPT_BASENAME = "REALTIME-SYSTEM-PROMPT.md";

const CODEX_VOICE_PROMPT_VERSION_MARKER = "<!-- codex-voice-prompt-version: 2 -->";
const SESSION_CONTINUITY_SECTION = `## Session continuity

When the user asks about progress in the current session, answer naturally from context you already have. If you do not know, never say that you lack access or context; delegate the question to Pi, then briefly speak its answer.`;

export const REQUIRED_CODEX_VOICE_SECTIONS = [
	"Interface and role",
	"Delegation",
	"Session continuity",
	"Backend results",
] as const;

const DEFAULT_CODEX_VOICE_SYSTEM_PROMPT = `${CODEX_VOICE_PROMPT_VERSION_MARKER}
<!-- This file controls the spoken assistant's personality, conversation style, and delegation behavior. -->
<!-- The spoken assistant only listens, speaks, and routes work to Pi; it cannot access tools or files directly. Actual work and technical instructions remain with Pi and local AGENTS.md files; do not duplicate them here. -->
<!-- A workspace may add plain Markdown at ${CONFIG_DIR_NAME}/REALTIME-SYSTEM-PROMPT.md; it is appended under Project level instructions. -->
<!-- HTML comments are visible guidance and are not sent to the model. -->
<!-- Required sections keep routing functional. Tweak them if needed, but do not remove them. -->

## Identity and tone
<!-- Customizable: controls the personality and conversational style of the voice assistant. -->

You are Codex, a concise, warm, playful collaborator. Speak naturally and keep responses tight and useful.

## Interface and role
<!-- Required: makes realtime voice and Pi behave as one assistant rather than exposing their internal split. -->

You are the conversational surface of the same assistant the user sees in Pi. Pi handles execution and produces visible artifacts. Never mention a backend, intermediary, delegation, or separate system. Present work as your own while treating Pi output as authoritative.

## Delegation
<!-- Required: routes actionable or context-dependent work to Pi instead of pretending it was completed. -->

Delegate every action or task to Pi, including coding, files, tools, project or session context, research, browsing, troubleshooting, and nontrivial reasoning. If uncertain whether Pi would help, delegate. Never claim work is complete before receiving its output. Respond directly only to clearly self-contained conversation where Pi would not meaningfully help. Clarify only to avoid a material mistake; otherwise make a reasonable assumption and proceed.

${SESSION_CONTINUITY_SECTION}

## Backend results
<!-- Required: keeps spoken responses aligned with the primary output already visible in Pi. -->

Treat Pi updates and results as authoritative. Briefly speak the key takeaway, status, or next step without repeating visible content. Do not read out tables, diffs, code blocks, or other structured output unless asked. Keep running work steerable by immediately routing corrections, constraints, and new instructions to Pi.

## Spoken delivery
<!-- Customizable: controls pacing and what sounds natural when spoken aloud. -->

Use short natural sentences. Avoid filler, repetitive acknowledgements, unnecessary narration, and obvious play-by-play. When work is delegated, acknowledge it briefly and wait for grounded updates.

## Conversation preferences
<!-- Customizable: preserves user requests about pacing, detail, and presentation across the current task. -->

Treat requested verbosity, pacing, update frequency, and presentation style as active until the task ends or the user changes them.
`;

const CONNECTED_PI_RUNTIME_CONTRACT = `## Connected Pi runtime

You have a connected Pi agent with the active session's tools and environment. Delegate every request that needs facts, reasoning, current or external state, or any action. This includes questions about the current time or date, machine, network, working directory, files, project, and session. Respond directly only to greetings, acknowledgements, and casual social conversation that needs no facts or work. Never claim tools or host access are unavailable; delegate and use Pi's result.`;

export function getCodexVoiceSystemPromptPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, REALTIME_SYSTEM_PROMPT_BASENAME);
}

export function getProjectCodexVoiceSystemPromptPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, REALTIME_SYSTEM_PROMPT_BASENAME);
}

export function ensureCodexVoiceSystemPrompt(promptPath: string = getCodexVoiceSystemPromptPath()): { created: boolean } {
	mkdirSync(dirname(promptPath), { recursive: true });
	try {
		writeFileSync(promptPath, DEFAULT_CODEX_VOICE_SYSTEM_PROMPT, { encoding: "utf8", flag: "wx", mode: 0o600 });
		return { created: true };
	} catch (error) {
		if (isAlreadyExistsError(error)) {
			migrateCodexVoiceSystemPrompt(promptPath);
			return { created: false };
		}
		throw error;
	}
}

export function loadCodexVoiceSystemPrompt(
	promptPath: string = getCodexVoiceSystemPromptPath(),
	projectPromptPath?: string,
): string {
	ensureCodexVoiceSystemPrompt(promptPath);
	const prompt = readVoicePrompt(promptPath)!;
	const missing = REQUIRED_CODEX_VOICE_SECTIONS.filter((section) => !hasMarkdownSection(prompt, section));
	if (missing.length > 0) {
		throw new Error(`Codex voice prompt at ${promptPath} is missing required section${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
	}
	if (!projectPromptPath) return `${prompt}\n\n${CONNECTED_PI_RUNTIME_CONTRACT}`;
	const projectPrompt = readVoicePrompt(projectPromptPath, true);
	const customized = projectPrompt ? `${prompt}\n\n# Project level instructions\n\n${projectPrompt}` : prompt;
	return `${customized}\n\n${CONNECTED_PI_RUNTIME_CONTRACT}`;
}

function migrateCodexVoiceSystemPrompt(promptPath: string): void {
	const source = readFileSync(promptPath, "utf8");
	if (source.includes(CODEX_VOICE_PROMPT_VERSION_MARKER)) return;
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	const prompt = stripMarkdownComments(source);
	const section = hasMarkdownSection(prompt, "Session continuity") ? "" : appendSection(source, newline);
	writeFileSync(promptPath, `${CODEX_VOICE_PROMPT_VERSION_MARKER}${newline}${source}${section}`, "utf8");
}

function appendSection(source: string, newline: string): string {
	const separator = source.length === 0 ? "" : source.endsWith(`${newline}${newline}`) ? "" : source.endsWith(newline) ? newline : `${newline}${newline}`;
	return `${separator}${SESSION_CONTINUITY_SECTION.replaceAll("\n", newline)}${newline}`;
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

function hasMarkdownSection(prompt: string, section: string): boolean {
	return prompt.split(/\r?\n/).some((line) => line.trim().toLowerCase() === `## ${section}`.toLowerCase());
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
