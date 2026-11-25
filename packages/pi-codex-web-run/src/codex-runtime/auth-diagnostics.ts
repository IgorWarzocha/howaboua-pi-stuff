import { readStoredCredential } from "@earendil-works/pi-coding-agent";

/** Inspect stored metadata only after an authentication or route failure. */
export function codexLoginDiagnostic(rejected = false): string {
	try {
		const legacy = readStoredCredential("openai-codex");
		const current = readStoredCredential("openai");
		if (legacy) {
			if (rejected || (legacy.type === "oauth" && legacy.expires <= Date.now()))
				return "Legacy OpenAI Codex login expired or was rejected. Ask the user to renew it.";
			return "Codex-compatible route required. The separate OpenAI Codex login is stored but unavailable for this request.";
		}
		if (current?.type === "oauth")
			return "ChatGPT sign-in cannot authorize this tool. Ask the user for a separate legacy OpenAI Codex sign-in.";
		return "Ask the user to sign in to OpenAI Codex separately.";
	} catch {
		return "Cannot read OpenAI Codex login status. Ask the user to check their login.";
	}
}

/** Preserve the failure class without exposing backend details. */
export function codexProviderFailure(error: unknown, legacy = true): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (/timeout|timed out/i.test(message))
		return new Error("Provider request timed out. Try again later.");
	if (/quota|rate.limit|\b429\b/i.test(message))
		return new Error("Provider quota or rate limit hit. Try again later.");
	if (/server|\b5\d\d\b/i.test(message))
		return new Error("Provider service failed. Try again later.");
	if (/network|fetch|connect|socket|dns/i.test(message))
		return new Error("Provider connection failed. Try again later.");
	if (
		/auth|credential|login|token|api.?key|accountId|Codex-compatible/i.test(
			message,
		)
	)
		return new Error(
			legacy
				? codexLoginDiagnostic(
						/expired|rejected|invalid.grant|unauthorized|accountId/i.test(
							message,
						),
					)
				: "Provider auth unavailable. Ask the user to check access for the configured provider.",
		);
	return new Error("Provider request failed.");
}
