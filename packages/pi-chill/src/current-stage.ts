import { stripTerminalSequences } from "@earendil-works/pi-tui";

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

function toolLabel(name: string, input: unknown, done = false): string {
	const key = name.split(/[./]/).at(-1) ?? name;
	const verbs: Record<string, [string, string]> = {
		read: ["Reading", "Read"],
		write: ["Writing", "Wrote"],
		edit: ["Editing", "Edited"],
		apply_patch: ["Applying patch", "Applied patch"],
		bash: ["Running command", "Ran command"],
		exec_command: ["Running command", "Ran command"],
		write_stdin: ["Waiting for command", "Checked command"],
		exec: ["Running code", "Ran code"],
		wait: ["Waiting for code", "Waited for code"],
		ls: ["Exploring", "Explored"],
		find: ["Finding files", "Found files"],
		grep: ["Searching files", "Searched files"],
		view_image: ["Viewing image", "Viewed image"],
	};
	const title = key
		.replace(/_/g, " ")
		.replace(/^./, (letter) => letter.toUpperCase());
	const friendly =
		verbs[key]?.[done ? 1 : 0] ?? `${done ? "Used" : "Using"} ${title}`;
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
	| { active: string | undefined; completed: { id: string; label: string }[] }
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
	const trace =
		traces.findLast((item) => item["status"] === "blocked") ??
		traces.findLast((item) => item["status"] === "running");
	if (traces.length === 0) return undefined;
	const labelFor = (item: Record<string, unknown>) =>
		compact(
			`${toolLabel(String(item["name"]), item["input"], item["status"] === "done")}${item["status"] === "blocked" ? " · needs attention" : item["status"] === "error" ? " · failed" : ""}`,
		);
	return {
		active: trace ? labelFor(trace) : undefined,
		completed: traces
			.filter((item) => item["status"] === "done" || item["status"] === "error")
			.slice(-2)
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
				label: compact(
					`${toolLabel(call["name"], call["arguments"], call["status"] === "ok")}${call["status"] === "error" ? " · failed" : ""}`,
				),
			},
		];
	});
}

interface RunningTool {
	name: string;
	input: unknown;
	activeTrace: string | undefined;
	hasNested: boolean;
	parent: string | undefined;
}

export class CurrentStage {
	private readonly running = new Map<string, RunningTool>();
	private readonly completed: string[] = [];
	private readonly seenCompletions = new Set<string>();
	private reasoningHeading: string | undefined;
	private phase:
		| { type: "thinking"; heading?: string | undefined }
		| { type: "activity"; label: string } = { type: "thinking" };

	thinking(content: string): void {
		// Empty stream starts and tool gaps carry no new reasoning evidence.
		if (!content.trim()) {
			this.phase = { type: "thinking", heading: this.reasoningHeading };
			return;
		}
		// A real Markdown heading is evidence. Arbitrary reasoning prose is not a title.
		const headings = [
			...content
				.slice(-8192)
				.matchAll(
					/(?:^|\n)\s*(?:#{1,6}\s+([^\n]+)|\*\*([^\n]+?)\*\*)\s*(?=\n|$)/g,
				),
		];
		const heading = headings.at(-1);
		this.reasoningHeading = heading
			? compact(heading[1] ?? heading[2] ?? "")
			: undefined;
		this.phase = {
			type: "thinking",
			heading: this.reasoningHeading,
		};
	}

	writing(): void {
		this.phase = { type: "activity", label: "Writing response" };
	}

	start(id: string, name: string, input: unknown, parent?: string): void {
		this.running.set(id, {
			name,
			input,
			activeTrace: undefined,
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
		const label = compact(
			`${toolLabel(tool.name, tool.input, !error)}${error ? " · failed" : ""}`,
		);
		const parent = tool.parent ? this.running.get(tool.parent) : undefined;
		if (parent?.activeTrace === toolLabel(tool.name, tool.input))
			parent.activeTrace = undefined;
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
			if (this.completed.length > 2) this.completed.shift();
		}
	}

	finish(): void {
		this.running.clear();
		this.seenCompletions.clear();
	}

	private showRunning(): void {
		// Prefer a live nested call over its outer executor, including parallel calls.
		const tools = [...this.running.values()];
		const active =
			tools.findLast((tool) => tool.parent !== undefined) ??
			tools.findLast((tool) => tool.activeTrace !== undefined) ??
			tools.at(-1);
		this.phase = active
			? {
					type: "activity",
					label: active.activeTrace ?? toolLabel(active.name, active.input),
				}
			: { type: "thinking", heading: this.reasoningHeading };
	}

	summary(): string {
		return this.completed.join(" · ");
	}

	label(): string {
		return this.phase.type === "thinking"
			? this.phase.heading || "Thinking"
			: this.phase.label;
	}
}
