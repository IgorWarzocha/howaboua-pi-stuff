import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BtwConfig, ThinkingLevel } from "./types.js";

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingLevel[];

const ALLOWED = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);
const DEFAULT_CONFIG: Required<BtwConfig> = {
	model: "openai-codex/gpt-5.4-mini",
	provider: "",
	thinking: "low",
	command: "pi",
	injectShortcut: "alt+c",
	dismissShortcut: "alt+x",
	composeShortcut: "alt+z",
};

function agentDir() {
	return (
		process.env["PI_CODING_AGENT_DIR"]?.trim() ||
		path.join(os.homedir(), ".pi", "agent")
	);
}

export function configPath() {
	return path.join(agentDir(), "pi-smart-btw.json");
}

export function ensureConfig() {
	fs.mkdirSync(agentDir(), { recursive: true });
	if (!fs.existsSync(configPath()))
		fs.writeFileSync(
			configPath(),
			JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
		);
}

export function readConfig(): Required<BtwConfig> {
	ensureConfig();
	let parsed: Partial<BtwConfig> = {};
	try {
		parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
	} catch {}
	const model =
		typeof parsed.model === "string" && parsed.model.trim()
			? parsed.model.trim()
			: DEFAULT_CONFIG.model;
	const thinking =
		parsed.thinking && ALLOWED.has(parsed.thinking)
			? parsed.thinking
			: DEFAULT_CONFIG.thinking;
	return {
		model,
		provider:
			typeof parsed.provider === "string"
				? parsed.provider
				: DEFAULT_CONFIG.provider,
		thinking,
		command:
			typeof parsed.command === "string" && parsed.command.trim()
				? parsed.command.trim()
				: DEFAULT_CONFIG.command,
		injectShortcut:
			typeof parsed.injectShortcut === "string" && parsed.injectShortcut.trim()
				? parsed.injectShortcut.trim()
				: DEFAULT_CONFIG.injectShortcut,
		dismissShortcut:
			typeof parsed.dismissShortcut === "string" &&
			parsed.dismissShortcut.trim()
				? parsed.dismissShortcut.trim()
				: DEFAULT_CONFIG.dismissShortcut,
		composeShortcut:
			typeof parsed.composeShortcut === "string" &&
			parsed.composeShortcut.trim()
				? parsed.composeShortcut.trim()
				: DEFAULT_CONFIG.composeShortcut,
	};
}

export function writeConfig(
	config: Required<BtwConfig>,
): { ok: true } | { ok: false; error: string } {
	try {
		ensureConfig();
		fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatBtwSettings(config: Required<BtwConfig>): string {
	return `BTW: model ${config.model}, thinking ${config.thinking}, command ${config.command}`;
}
