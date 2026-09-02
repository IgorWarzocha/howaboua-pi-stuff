import { CODEX_TOOL_ORIGINATOR, type CodexToolProvider } from "./types.js";

export function codexToolProviderHeaders(provider: CodexToolProvider): Headers {
	const headers = new Headers();
	headers.set("Authorization", "Bearer " + provider.token);
	headers.set("ChatGPT-Account-ID", provider.accountId);
	headers.set("originator", CODEX_TOOL_ORIGINATOR);
	headers.set("User-Agent", codexWebRunUserAgent(CODEX_TOOL_ORIGINATOR));
	headers.set("version", "0.0.0");
	headers.set("content-type", "application/json");
	return headers;
}

function codexWebRunUserAgent(
	originator: string = CODEX_TOOL_ORIGINATOR,
): string {
	const platform =
		process.platform === "darwin"
			? "Mac OS"
			: process.platform === "win32"
				? "Windows"
				: process.platform === "linux"
					? "Linux"
					: process.platform;
	const arch = process.arch === "arm64" ? "arm64" : process.arch;
	const terminal =
		process.env["TERM_PROGRAM"]?.trim() ||
		process.env["TERM"]?.trim() ||
		"unknown";
	return (
		originator + "/0.0.0 (" + platform + " unknown; " + arch + ") " + terminal
	);
}
