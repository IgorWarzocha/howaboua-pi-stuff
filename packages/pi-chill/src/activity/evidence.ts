import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Current activity is derived only from streamed message blocks and tool evidence. */
function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function compact(value: string): string {
	const plain = stripTerminalSequences(value)
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > 100 ? `${plain.slice(0, 97)}...` : plain;
}

export function toolLabel(
	name: string,
	input: unknown,
	done = false,
	warning?: "blocked" | "failed",
): string {
	const key = name.split(/[./]/).at(-1) ?? name;
	// Status belongs to the name, before the optional target can be shortened.
	const friendly = `${warning === "blocked" ? "Needs attention" : warning === "failed" ? "Failed" : done ? "Used" : "Running"} ${key}`;
	const args = record(input);
	let target = args?.["path"] ?? args?.["file_path"];
	if (key === "exec_command" || key === "bash")
		target = args?.["cmd"] ?? args?.["command"];
	if (key === "apply_patch" && typeof input === "string")
		target = input.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1];
	return compact(
		`${friendly}${typeof target === "string" ? ` · ${target}` : ""}`,
	);
}

export function traceActivity(
	name: string,
	result: unknown,
):
	| { active: string[]; completed: { id: string; label: string }[] }
	| undefined {
	// PCC trace updates omit codeMode. Restrict this boundary to its outer tools.
	if (name !== "exec" && name !== "wait") return undefined;
	const details = record(record(result)?.["details"]);
	if (!details || !Array.isArray(details["traces"])) return undefined;
	const traces = details["traces"].flatMap((value: unknown) => {
		const trace = record(value);
		return trace &&
			typeof trace["id"] === "string" &&
			typeof trace["name"] === "string" &&
			["running", "blocked", "done", "error"].includes(String(trace["status"]))
			? [trace]
			: [];
	});
	const active = traces.filter(
		(item) => item["status"] === "blocked" || item["status"] === "running",
	);
	if (traces.length === 0) return undefined;
	const labelFor = (item: Record<string, unknown>) =>
		toolLabel(
			String(item["name"]),
			item["input"],
			item["status"] === "done" || item["status"] === "error",
			item["status"] === "blocked"
				? "blocked"
				: item["status"] === "error"
					? "failed"
					: undefined,
		);
	return {
		active: active.map(labelFor),
		completed: traces
			.filter((item) => item["status"] === "done" || item["status"] === "error")
			.slice(-8)
			.map((item) => ({
				id: `trace:${String(details["cellId"] ?? "")}:${String(item["id"])}`,
				label: labelFor(item),
			})),
	};
}

export function nativeActivity(
	result: unknown,
): { id: string; label: string }[] | undefined {
	const calls = record(record(result)?.["nestedCalls"])?.["calls"];
	if (!Array.isArray(calls)) return undefined;
	return calls.slice(-256).flatMap((value: unknown) => {
		const call = record(value);
		if (
			!call ||
			typeof call["id"] !== "string" ||
			typeof call["name"] !== "string" ||
			(call["status"] !== "ok" && call["status"] !== "error")
		)
			return [];
		return [
			{
				id: call["id"],
				label: toolLabel(
					call["name"],
					call["arguments"],
					true,
					call["status"] === "error" ? "failed" : undefined,
				),
			},
		];
	});
}
