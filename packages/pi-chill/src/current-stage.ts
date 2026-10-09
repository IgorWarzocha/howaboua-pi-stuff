import {
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

/** Current activity is derived only from streamed message blocks and tool evidence. */
function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function compact(value: string): string {
	const plain = stripTerminalSequences(value)
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > 100 ? `${plain.slice(0, 97)}...` : plain;
}

function toolLabel(
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

function traceActivity(
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

function nativeActivity(
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

interface RunningTool {
	name: string;
	input: unknown;
	activeTrace: string[];
	hasNested: boolean;
	parent: string | undefined;
}

export class CurrentStage {
	private readonly running = new Map<string, RunningTool>();
	private readonly completed: string[] = [];
	private readonly seenCompletions = new Set<string>();
	private phase:
		| { type: "thinking"; heading?: string | undefined }
		| { type: "activity"; labels: string[] } = { type: "thinking" };

	thinking(content: string): void {
		// Only new displayable evidence replaces the last label.
		if (!content.trim()) return;
		// A real Markdown heading is evidence. Arbitrary reasoning prose is not a title.
		const headings = [
			...content
				.slice(-8192)
				.matchAll(
					/(?:^|\n)\s*(?:#{1,6}\s+([^\n]+)|\*\*([^\n]+?)\*\*)\s*(?=\n|$)/g,
				),
		];
		const heading = headings.at(-1);
		if (!heading) return;
		this.phase = {
			type: "thinking",
			heading: compact(heading[1] ?? heading[2] ?? ""),
		};
	}

	start(id: string, name: string, input: unknown, parent?: string): void {
		this.running.set(id, {
			name,
			input,
			activeTrace: [],
			hasNested: false,
			parent,
		});
		const outer = parent ? this.running.get(parent) : undefined;
		if (outer) outer.hasNested = true;
		this.showRunning();
	}

	update(id: string, result: unknown): void {
		const tool = this.running.get(id);
		if (!tool) return;
		const trace = traceActivity(tool.name, result);
		if (trace) {
			tool.activeTrace = trace.active;
			tool.hasNested = true;
			this.remember(trace.completed);
		}
		this.showRunning();
	}

	end(id: string, result: unknown, error: boolean): void {
		const tool = this.running.get(id);
		if (!tool) return;
		this.running.delete(id);
		const nested = traceActivity(tool.name, result);
		const native = nativeActivity(result);
		const label = toolLabel(
			tool.name,
			tool.input,
			true,
			error ? "failed" : undefined,
		);
		const parent = tool.parent ? this.running.get(tool.parent) : undefined;
		if (parent)
			parent.activeTrace = parent.activeTrace.filter(
				(label) => label !== toolLabel(tool.name, tool.input),
			);
		if (native) this.remember(native);
		if (nested) this.remember(nested.completed);
		if (
			(!nested && !native && !tool.hasNested) ||
			(error && !nested?.completed.length && !native?.length)
		)
			this.remember([{ id, label }]);
		this.showRunning();
	}

	private remember(actions: { id: string; label: string }[]): void {
		for (const { id, label } of actions) {
			if (this.seenCompletions.has(id)) continue;
			this.seenCompletions.add(id);
			if (this.seenCompletions.size > 100) {
				const oldest = this.seenCompletions.values().next().value;
				if (oldest !== undefined) this.seenCompletions.delete(oldest);
			}
			const prior = this.completed.indexOf(label);
			if (prior >= 0) this.completed.splice(prior, 1);
			this.completed.push(label);
			if (this.completed.length > 8) this.completed.shift();
		}
	}

	finish(): void {
		this.running.clear();
		this.seenCompletions.clear();
	}

	private showRunning(): void {
		// A wrapper with observed children is not an extra task. Keep completed
		// child evidence during gaps rather than falling back to "Running exec".
		const labels = [...this.running.values()].flatMap((tool) =>
			tool.activeTrace.length
				? tool.activeTrace
				: tool.hasNested
					? []
					: [toolLabel(tool.name, tool.input)],
		);
		this.phase = {
			type: "activity",
			labels: [...new Set([...labels, ...this.completed.slice().reverse()])],
		};
	}

	summary(width = 100, format = (label: string) => label): string {
		return this.fit(this.completed.slice().reverse(), width, format);
	}

	label(width = 100, format = (label: string) => label): string {
		return this.phase.type === "thinking"
			? this.phase.heading || ""
			: this.fit(this.phase.labels, width, format);
	}

	private fit(
		labels: string[],
		width: number,
		format: (label: string) => string,
	): string {
		const seen = new Set<string>();
		labels = labels.filter((label) => {
			const name =
				label
					.split(" · ")[0]
					?.replace(/^(Running|Used|Failed|Needs attention) /, "") ?? label;
			if (seen.has(name)) return false;
			seen.add(name);
			return true;
		});
		if (!labels.length || width <= 0) return "";
		const full = labels.join(", ");
		if (visibleWidth(full) <= width) return labels.map(format).join(", ");
		const names = labels.map((label) => label.split(" · ")[0] ?? label);
		for (let count = names.length; count > 0; count--) {
			const suffix = count < names.length ? `, +${names.length - count}` : "";
			const text = names.slice(0, count).join(", ") + suffix;
			if (visibleWidth(text) <= width)
				return names.slice(0, count).map(format).join(", ") + suffix;
		}
		const suffix = names.length > 1 ? ` +${names.length - 1}` : "";
		return truncateToWidth(
			truncateToWidth(
				format(names[0] ?? ""),
				Math.max(0, width - visibleWidth(suffix)),
			) + suffix,
			width,
		);
	}
}
