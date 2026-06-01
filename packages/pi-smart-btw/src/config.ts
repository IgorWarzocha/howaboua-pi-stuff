import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SHORTCUTS } from "./constants.js";
import type { BtwConfig, ResolvedBtwConfig, ThinkingLevel } from "./types.js";

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const satisfies readonly ThinkingLevel[];

const ALLOWED = new Set<ThinkingLevel>(THINKING_LEVELS);

const DEFAULT_CONFIG: ResolvedBtwConfig = {
	provider: "openai-codex",
	modelId: "gpt-5.4-mini",
	command: "pi",
	thinking: "low",
	composeShortcut: DEFAULT_SHORTCUTS.compose,
	injectShortcut: DEFAULT_SHORTCUTS.inject,
	dismissShortcut: DEFAULT_SHORTCUTS.clear,
	foldShortcut: DEFAULT_SHORTCUTS.fold,
	unfoldShortcut: DEFAULT_SHORTCUTS.unfold,
	previousShortcut: DEFAULT_SHORTCUTS.previous,
	nextShortcut: DEFAULT_SHORTCUTS.next,
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

export function modelRef(provider: string, modelId: string) {
	return `${provider}/${modelId}`;
}

export function splitModelRef(ref: string): {
	provider: string;
	modelId: string;
} {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) {
		return {
			provider: DEFAULT_CONFIG.provider,
			modelId: ref.trim() || DEFAULT_CONFIG.modelId,
		};
	}
	return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function migrateParsed(parsed: Partial<BtwConfig>): Partial<BtwConfig> {
	const legacy = typeof parsed.model === "string" ? parsed.model.trim() : "";
	if (legacy.includes("/")) {
		const { provider, modelId } = splitModelRef(legacy);
		const { model: _legacy, ...rest } = parsed;
		return { ...rest, provider, modelId };
	}
	if (parsed.provider?.trim() && parsed.modelId?.trim()) return parsed;
	const provider =
		typeof parsed.provider === "string" && parsed.provider.trim()
			? parsed.provider.trim()
			: DEFAULT_CONFIG.provider;
	const modelId =
		legacy ||
		(typeof parsed.modelId === "string" && parsed.modelId.trim()
			? parsed.modelId.trim()
			: DEFAULT_CONFIG.modelId);
	return { ...parsed, provider, modelId };
}

export function ensureConfig() {
	fs.mkdirSync(agentDir(), { recursive: true });
	if (!fs.existsSync(configPath()))
		fs.writeFileSync(
			configPath(),
			JSON.stringify(
				{
					provider: DEFAULT_CONFIG.provider,
					modelId: DEFAULT_CONFIG.modelId,
					command: DEFAULT_CONFIG.command,
					thinking: DEFAULT_CONFIG.thinking,
					composeShortcut: DEFAULT_CONFIG.composeShortcut,
					injectShortcut: DEFAULT_CONFIG.injectShortcut,
					dismissShortcut: DEFAULT_CONFIG.dismissShortcut,
					foldShortcut: DEFAULT_CONFIG.foldShortcut,
					unfoldShortcut: DEFAULT_CONFIG.unfoldShortcut,
					previousShortcut: DEFAULT_CONFIG.previousShortcut,
					nextShortcut: DEFAULT_CONFIG.nextShortcut,
				},
				null,
				2,
			) + "\n",
		);
}

export function readConfig(): ResolvedBtwConfig {
	ensureConfig();
	let parsed: Partial<BtwConfig> = {};
	try {
		parsed = migrateParsed(JSON.parse(fs.readFileSync(configPath(), "utf8")));
	} catch {
		parsed = migrateParsed({});
	}
	const thinking =
		parsed.thinking && ALLOWED.has(parsed.thinking)
			? parsed.thinking
			: DEFAULT_CONFIG.thinking;
	const provider =
		typeof parsed.provider === "string" && parsed.provider.trim()
			? parsed.provider.trim()
			: DEFAULT_CONFIG.provider;
	const modelId =
		typeof parsed.modelId === "string" && parsed.modelId.trim()
			? parsed.modelId.trim()
			: DEFAULT_CONFIG.modelId;
	const command =
		typeof parsed.command === "string" && parsed.command.trim()
			? parsed.command.trim()
			: DEFAULT_CONFIG.command;
	const shortcut = (value: string | undefined, fallback: string) =>
		typeof value === "string" && value.trim() ? value.trim() : fallback;
	return {
		provider,
		modelId,
		command,
		thinking,
		composeShortcut: shortcut(
			parsed.composeShortcut,
			DEFAULT_CONFIG.composeShortcut,
		),
		injectShortcut: shortcut(
			parsed.injectShortcut,
			DEFAULT_CONFIG.injectShortcut,
		),
		dismissShortcut: shortcut(
			parsed.dismissShortcut,
			DEFAULT_CONFIG.dismissShortcut,
		),
		foldShortcut: shortcut(parsed.foldShortcut, DEFAULT_CONFIG.foldShortcut),
		unfoldShortcut: shortcut(
			parsed.unfoldShortcut,
			DEFAULT_CONFIG.unfoldShortcut,
		),
		previousShortcut: shortcut(
			parsed.previousShortcut,
			DEFAULT_CONFIG.previousShortcut,
		),
		nextShortcut: shortcut(parsed.nextShortcut, DEFAULT_CONFIG.nextShortcut),
	};
}

export function writeConfig(
	config: ResolvedBtwConfig,
): { ok: true } | { ok: false; error: string } {
	try {
		ensureConfig();
		const {
			provider,
			modelId,
			thinking,
			command,
			composeShortcut,
			injectShortcut,
			dismissShortcut,
			foldShortcut,
			unfoldShortcut,
			previousShortcut,
			nextShortcut,
		} = config;
		fs.writeFileSync(
			configPath(),
			JSON.stringify(
				{
					provider,
					modelId,
					thinking,
					command,
					composeShortcut,
					injectShortcut,
					dismissShortcut,
					foldShortcut,
					unfoldShortcut,
					previousShortcut,
					nextShortcut,
				},
				null,
				2,
			) + "\n",
		);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatBtwSettings(config: ResolvedBtwConfig): string {
	return `BTW: ${modelRef(config.provider, config.modelId)} thinking ${config.thinking}`;
}
