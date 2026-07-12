import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface MarkdownWorkflowsConfig {
	toolRegistration: boolean;
}

export const CONFIG_PATH = path.join(getAgentDir(), "markdown-workflows.json");
export const DEFAULT_CONFIG: MarkdownWorkflowsConfig = {
	toolRegistration: true,
};

export function ensureConfig(): MarkdownWorkflowsConfig {
	mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
	if (!existsSync(CONFIG_PATH)) {
		writeFileSync(
			CONFIG_PATH,
			`${JSON.stringify(DEFAULT_CONFIG, null, "\t")}\n`,
		);
	}
	return {
		...DEFAULT_CONFIG,
		...(JSON.parse(
			readFileSync(CONFIG_PATH, "utf8"),
		) as Partial<MarkdownWorkflowsConfig>),
	};
}
