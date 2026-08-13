const MAX_REMOTE_VALUE_BYTES = 256 * 1024;

export function remoteJsonValue(value: unknown): unknown {
	const seen = new WeakSet<object>();
	const json = JSON.stringify(value, (_key, current: unknown) => {
		if (typeof current === "bigint") return current.toString();
		if (current instanceof Error)
			return { name: current.name, message: current.message };
		if (typeof current === "function" || typeof current === "symbol")
			return undefined;
		if (current && typeof current === "object") {
			if (seen.has(current)) return "[Circular]";
			seen.add(current);
		}
		return current;
	});
	if (json === undefined) return null;
	if (Buffer.byteLength(json) <= MAX_REMOTE_VALUE_BYTES)
		return JSON.parse(json);
	return {
		truncated: true,
		preview: Buffer.from(json)
			.subarray(0, MAX_REMOTE_VALUE_BYTES)
			.toString("utf8"),
	};
}
