import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	compact,
	nativeActivity,
	toolLabel,
	traceActivity,
} from "./evidence.js";

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
