import { readStoredCredential } from "@earendil-works/pi-coding-agent";

/** Inspect stored metadata only after an authentication or route failure. */
export function codexLoginDiagnostic(rejected = false): string {
	try {
		const legacy = readStoredCredential("openai-codex");
		const current = readStoredCredential("openai");
		if (legacy) {
			if (rejected || (legacy.type === "oauth" && legacy.expires <= Date.now()))
				return "Legacy Codex login expired or was rejected. Explain to the user that they need to renew their separate OpenAI Codex login.";
			return "This tool needs a Codex-compatible route. A separate OpenAI Codex login is stored, but unavailable for this request.";
		}
		if (current?.type === "oauth")
			return "ChatGPT sign-in does not authorize this tool. Explain to the user that they need a separate legacy OpenAI Codex login.";
		return "This tool needs a separate OpenAI Codex login. Ask the user to sign in.";
	} catch {
		return "Login status could not be read. Ask the user to check their OpenAI Codex login.";
	}
}

/** Preserve the failure class without exposing backend details. */
export function codexProviderFailure(error: unknown, legacy = true): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (/timeout|timed out/i.test(message))
		return new Error("Provider request timed out. Try again later.");
	if (/quota|rate.limit|\b429\b/i.test(message))
		return new Error("Provider quota or rate limit reached. Try again later.");
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
				: "Provider authentication unavailable. Ask the user to check their configured provider access.",
		);
	return new Error("Provider request failed.");
}
