const MAX_REMOTE_VALUE_BYTES = 256 * 1024;
const MAX_REMOTE_STRING_BYTES = 32 * 1024;
const MAX_REMOTE_ARRAY_ITEMS = 256;
const MAX_REMOTE_OBJECT_PROPERTIES = 256;
const MAX_REMOTE_BINARY_BYTES = 16 * 1024;
const MAX_REMOTE_DEPTH = 12;

export function remoteJsonValue(value: unknown): unknown {
	const ancestors: object[] = [];
	const depths = new WeakMap<object, number>();
	const propertyCounts = new WeakMap<object, number>();
	const json = JSON.stringify(value, function (key, current: unknown) {
		if (key && this && typeof this === "object" && !Array.isArray(this)) {
			const count = (propertyCounts.get(this) ?? 0) + 1;
			propertyCounts.set(this, count);
			if (count > MAX_REMOTE_OBJECT_PROPERTIES) return undefined;
		}
		const source =
			key && this && typeof this === "object"
				? (this as Record<string, unknown>)[key]
				: current;
		if (typeof current === "string")
			return truncateUtf8(current, MAX_REMOTE_STRING_BYTES);
		if (typeof current === "bigint") return current.toString();
		if (source instanceof Error)
			return { name: source.name, message: source.message };
		if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
			const bytes = Buffer.from(
				source.buffer,
				source.byteOffset,
				source.byteLength,
			);
			const shown = bytes.subarray(0, MAX_REMOTE_BINARY_BYTES);
			return {
				type: "bytes",
				byteLength: bytes.byteLength,
				base64: shown.toString("base64"),
				...(shown.byteLength < bytes.byteLength ? { truncated: true } : {}),
			};
		}
		if (typeof current === "function" || typeof current === "symbol")
			return undefined;
		if (!current || typeof current !== "object") return current;
		const depth =
			((this && typeof this === "object" ? depths.get(this) : undefined) ??
				-1) + 1;
		if (depth > MAX_REMOTE_DEPTH) return "[Truncated]";
		depths.set(current, depth);
		while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
		if (ancestors.includes(current)) return "[Circular]";
		propertyCounts.set(current, 0);
		ancestors.push(current);
		if (Array.isArray(current) && current.length > MAX_REMOTE_ARRAY_ITEMS) {
			const bounded = [
				...current.slice(0, MAX_REMOTE_ARRAY_ITEMS),
				"[Truncated]",
			];
			depths.set(bounded, depth);
			return bounded;
		}
		return current;
	});
	if (json === undefined) return null;
	if (Buffer.byteLength(json) <= MAX_REMOTE_VALUE_BYTES)
		return JSON.parse(json);
	return {
		truncated: true,
		preview: truncateUtf8(json, MAX_REMOTE_VALUE_BYTES),
	};
}

function truncateUtf8(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value) <= maxBytes) return value;
	const contentBytes = maxBytes - Buffer.byteLength("…");
	let low = 0;
	let high = Math.min(value.length, contentBytes);
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(value.slice(0, middle)) <= contentBytes) low = middle;
		else high = middle - 1;
	}
	if (/^[\uDC00-\uDFFF]$/.test(value[low] ?? "")) low -= 1;
	return `${value.slice(0, low)}…`;
}
