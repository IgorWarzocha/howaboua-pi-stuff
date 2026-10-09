const SENSITIVE_KEYS = new Set([
	"token",
	"access_token",
	"api_key",
	"client_secret",
	"credential",
	"credentials",
	"private_key",
	"refresh",
	"refresh_token",
	"password",
	"secret",
	"authorization",
	"siwc_bypass_bearer_token",
	"source_repository_credential",
]);

export function redact(value) {
	return redactValue(value, new WeakSet());
}

function redactValue(value, seen) {
	if (typeof value === "string") return redactString(value);
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (Array.isArray(value))
		return value.map((entry) => redactValue(entry, seen));

	const output = {};
	const secretEnvironmentEntry = value.is_secret === true;
	for (const [key, entry] of Object.entries(value)) {
		if (
			SENSITIVE_KEYS.has(key.toLowerCase()) ||
			(secretEnvironmentEntry && key === "value")
		) {
			output[key] = "[redacted]";
		} else {
			output[key] = redactValue(entry, seen);
		}
	}
	return output;
}

function redactString(value) {
	return value
		.replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1[redacted]@")
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
		.replace(
			/([?&](?:token|access_token|key|signature|sig)=)[^&#\s]+/gi,
			"$1[redacted]",
		);
}

export function boundedJson(value, maxBytes = 32_000) {
	const serialized = JSON.stringify(redact(value), null, 2);
	if (Buffer.byteLength(serialized) <= maxBytes) return serialized;
	return JSON.stringify(
		{
			ok: false,
			error: {
				code: "output_too_large",
				message:
					"Sites output was truncated; use narrower filters or pagination",
				original_bytes: Buffer.byteLength(serialized),
			},
		},
		null,
		2,
	);
}
