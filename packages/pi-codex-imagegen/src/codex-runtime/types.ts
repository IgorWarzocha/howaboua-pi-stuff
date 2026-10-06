import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CODEX_TOOL_ORIGINATOR = "codex_cli_rs";
export const OPENAI_CODEX_PROVIDER = "openai-codex";
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export interface CodexToolProvider {
	/** Provider whose credentials were selected, when resolved locally. */
	authProvider?: string;
	route: "openai-codex" | "configured-responses";
	baseUrl: string;
	responsesUrl: string;
	searchUrl: string;
	model: string | undefined;
	token: string;
	accountId: string;
}

export type AllowConfiguredCodexToolProvider = (
	model: ExtensionContext["model"],
) => boolean;
