import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CHILD_ENV = "PI_REVIEW_EXTENSION_CHILD";
export const REVIEW_COMMAND = "review";
export const REVIEW_LABEL = "Review";
export const CONFIG_FILENAME = "pi-subagent-review.json";
export const REVIEW_PROMPT_PATH = path.join(
	path.resolve(__dirname, ".."),
	"review.prompt.md",
);

export const DEFAULT_CONFIG = {
	model: "openai-codex/gpt-5.6-sol",
	thinking: "medium",
	summary: {
		enabled: true,
		model: "openai-codex/gpt-5.6-luna",
		thinking: "low",
	},
} as const;

export const ALLOWED_THINKING = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const);
export const RPC_READY_TIMEOUT_MS = 10_000;
export const RPC_RESPONSE_TIMEOUT_MS = 30_000;

export function getAgentDir(): string {
	const configured = process.env["PI_CODING_AGENT_DIR"]?.trim();
	return configured || path.join(os.homedir(), ".pi", "agent");
}

export function getConfigPath(): string {
	return path.join(getAgentDir(), CONFIG_FILENAME);
}
