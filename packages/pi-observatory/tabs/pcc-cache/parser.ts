type Scalar = string | number | boolean | null;
export interface LogEvent {
	time: string;
	fields: Record<string, Scalar>;
}
export type ParsedLine =
	| { kind: "header"; key: string; value: string }
	| { kind: "event"; event: LogEvent }
	| { kind: "ignore" }
	| { kind: "malformed" };

const fieldsKept = new Set([
	"event",
	"local_request_id",
	"scope",
	"lane",
	"transport",
	"model",
	"attempt",
	"continuation",
	"canonical_history",
	"input_tokens",
	"cache_read",
	"cache_write",
	"output_tokens",
	"cache_usage",
	"request_elapsed_ms",
	"outcome",
	"failure",
	"code",
	"to",
	"instructions_fingerprint",
	"tools_fingerprint",
	"cache_key_fingerprint",
	"routing_fingerprint",
	"options_fingerprint",
	"service_tier",
	"request_counter_process_id",
	"compaction_source",
]);

/** Logger values are JSON primitives, not shell syntax. Never evaluate a log line. */
function parseFields(text: string): Record<string, Scalar> | null {
	const fields: Record<string, Scalar> = Object.create(null);
	let cursor = 0;
	while (cursor < text.length) {
		while (text[cursor] === " ") cursor++;
		if (cursor === text.length) break;
		const key = /^[a-z][a-z0-9_.]*=/.exec(text.slice(cursor))?.[0];
		if (!key) return null;
		cursor += key.length;
		const start = cursor;
		if (text[cursor] === '"') {
			cursor++;
			let closed = false;
			while (cursor < text.length) {
				if (text[cursor] === "\\") cursor += 2;
				else if (text[cursor++] === '"') {
					closed = true;
					break;
				}
			}
			if (!closed) return null;
		} else {
			while (cursor < text.length && text[cursor] !== " ") cursor++;
		}
		if (cursor < text.length && text[cursor] !== " ") return null;
		let value: unknown;
		try {
			value = JSON.parse(text.slice(start, cursor));
		} catch {
			return null;
		}
		if (
			!(
				value === null ||
				typeof value === "string" ||
				typeof value === "boolean" ||
				(typeof value === "number" && Number.isFinite(value))
			)
		)
			return null;
		const name = key.slice(0, -1);
		if (Object.hasOwn(fields, name)) return null;
		fields[name] = value;
	}
	return fields;
}

export function parseLine(line: string): ParsedLine {
	if (!line.trim()) return { kind: "ignore" };
	if (line.startsWith("#")) {
		const header = /^# (opened|session_id|session_name|cwd)=(.*)$/.exec(line);
		if (!header) return { kind: "ignore" };
		const key = header[1];
		const raw = header[2];
		if (!key || raw === undefined) return { kind: "malformed" };
		if (key === "opened") return { kind: "header", key, value: raw };
		try {
			const value: unknown = JSON.parse(raw);
			return typeof value === "string"
				? { kind: "header", key, value: value.slice(0, 500) }
				: { kind: "malformed" };
		} catch {
			return { kind: "malformed" };
		}
	}
	const timestamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/.exec(
		line,
	);
	if (
		!timestamp?.[1] ||
		timestamp[2] === undefined ||
		!Number.isFinite(Date.parse(timestamp[1]))
	)
		return { kind: "malformed" };
	const fields = parseFields(timestamp[2]);
	if (!fields || typeof fields["event"] !== "string")
		return { kind: "malformed" };
	if (
		![
			"request",
			"usage",
			"retry",
			"fallback",
			"failure",
			"prewarm-ready",
			"timing",
		].includes(fields["event"])
	)
		return { kind: "ignore" };
	return {
		kind: "event",
		event: {
			time: timestamp[1],
			fields: Object.fromEntries(
				Object.entries(fields).filter(([key]) => fieldsKept.has(key)),
			),
		},
	};
}

export function label(event: LogEvent, key: string): string | null {
	const value = event.fields[key];
	return typeof value === "string" && value ? value.slice(0, 500) : null;
}

export function counter(event: LogEvent, key: string): number | null {
	const value = event.fields[key];
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}
