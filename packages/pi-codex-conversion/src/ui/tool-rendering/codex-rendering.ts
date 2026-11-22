import {
	summarizeShellCommand,
	type ShellAction,
} from "../../shell/summary.ts";
import type {
	ExecCommandStatus,
	ExecExplorationCall,
	ExecOutcome,
} from "../../tools/exec/command-state.ts";

export interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

export function renderExecCommandCall(
	command: string,
	state: ExecCommandStatus,
	theme: RenderTheme,
	expanded = false,
	outcome?: ExecOutcome,
): string {
	const summary = summarizeShellCommand(command);
	return summary.maskAsExplored
		? renderExplorationText(
				[{ actions: summary.actions, command, outcome }],
				state,
				theme,
				expanded,
			)
		: renderCommandText(command, state, theme, expanded, outcome);
}

export function renderGroupedExecCommandCall(
	calls: ExecExplorationCall[],
	state: ExecCommandStatus,
	theme: RenderTheme,
	expanded = false,
): string {
	return renderExplorationText(calls, state, theme, expanded);
}

export function renderExecOutcome(
	outcome: ExecOutcome,
	theme: Pick<RenderTheme, "fg">,
	compound = false,
): string {
	if (outcome.kind === "no-matches")
		return theme.fg("muted", "No matches (exit 1)");
	return theme.fg(
		"error",
		`Exit ${outcome.exitCode}${compound ? " (command)" : ""}`,
	);
}

export function renderWriteStdinCall(
	sessionId: number | string,
	input: string | undefined,
	command: string | undefined,
	theme: RenderTheme,
): string {
	const interacted = typeof input === "string" && input.length > 0;
	const marker = interacted ? "↳ " : "• ";
	const title = interacted
		? "Interacted with background terminal"
		: "Waited for background terminal";
	let text = `${theme.fg("dim", marker)}${theme.bold(title)}`;
	const commandPreview = formatCommandPreview(command);
	if (commandPreview) {
		text += `${theme.fg("dim", " · ")}${theme.fg("muted", commandPreview)}`;
	}
	// Keep the session fallback only when we do not have a stable command display.
	if (!commandPreview) {
		text += `${theme.fg("dim", " ")}${theme.fg("muted", `#${sessionId}`)}`;
	}
	return text;
}

function renderExplorationText(
	calls: ExecExplorationCall[],
	state: ExecCommandStatus,
	theme: RenderTheme,
	expanded: boolean,
): string {
	const header = state === "running" ? "Exploring" : "Explored";
	let text = `${theme.fg("dim", "•")} ${theme.bold(header)}`;

	for (const [index, line] of formatExplorationLines(calls).entries()) {
		const prefix = index === 0 ? "  └ " : "    ";
		text += `\n${theme.fg("dim", prefix)}${theme.fg("accent", line.title)} ${theme.fg("muted", line.body)}`;
		if (line.outcome)
			text += `${theme.fg("dim", " · ")}${renderExecOutcome(line.outcome, theme, line.compound)}`;
	}

	for (const { command } of expanded ? calls : []) {
		for (const line of formatCommandLines(
			command,
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
		)) {
			text += `\n${theme.fg("dim", "    ")}${theme.fg("muted", line)}`;
		}
	}

	return text;
}

function renderCommandText(
	command: string,
	state: ExecCommandStatus,
	theme: RenderTheme,
	expanded: boolean,
	outcome?: ExecOutcome,
): string {
	const verb = state === "running" ? "Running" : "Ran";
	let text = `${theme.fg("dim", "•")} ${theme.bold(verb)}`;
	if (outcome)
		text += `${theme.fg("dim", " · ")}${renderExecOutcome(outcome, theme)}`;
	const maxLines = expanded ? Number.POSITIVE_INFINITY : 5;
	const maxLength = expanded ? Number.POSITIVE_INFINITY : 100;
	for (const [index, line] of formatCommandLines(
		command,
		maxLines,
		maxLength,
	).entries()) {
		const prefix = index === 0 ? "  └ " : "    ";
		text += `\n${theme.fg("dim", prefix)}${theme.fg("accent", line)}`;
	}
	return text;
}

function formatCommandLines(
	command: string,
	maxLines = 5,
	maxLength = 100,
): string[] {
	const lines = command
		.replace(/\t/g, "   ")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(
			(line, index, all) =>
				line.length > 0 || (index > 0 && index < all.length - 1),
		);
	const visible = lines
		.slice(0, maxLines)
		.map((line) => shortenLine(line, maxLength));
	if (lines.length > maxLines) {
		visible.push("...");
	}
	return visible.length > 0 ? visible : [""];
}

function shortenLine(line: string, max = 100): string {
	const trimmed = line.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 3)}...`;
}

function shortenCommand(command: string, max = 100): string {
	const trimmed = command.replace(/\s+/g, " ").trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 3)}...`;
}

function formatCommandPreview(command: string | undefined): string | undefined {
	if (!command) return undefined;
	const singleLine = command.replace(/\s+/g, " ").trim();
	if (singleLine.length === 0) return undefined;
	return shortenCommand(singleLine, 80);
}

interface ExplorationLine {
	title: string;
	body: string;
	outcome?: ExecOutcome | undefined;
	compound?: boolean | undefined;
}

function formatActionLine(action: ShellAction): ExplorationLine {
	if (action.kind === "read") {
		return { title: "Read", body: formatReadLabel(action) };
	}
	if (action.kind === "list") {
		return { title: "List", body: action.path ?? action.command };
	}
	if (action.kind === "search") {
		if (action.query && action.path) {
			return { title: "Search", body: `${action.query} in ${action.path}` };
		}
		if (action.query) {
			return { title: "Search", body: action.query };
		}
		return { title: "Search", body: action.command };
	}
	return { title: "Run", body: action.command };
}

function formatReadLabel(
	action: Extract<ShellAction, { kind: "read" }>,
): string {
	const skillName = skillNameFromSkillPath(action.path);
	return skillName ? `${skillName} skill` : action.name;
}

function skillNameFromSkillPath(path: string): string | undefined {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.at(-1) !== "SKILL.md") return undefined;
	if (parts.at(-3) !== "skills") return undefined;
	const skillDir = parts.at(-2);
	return skillDir && skillDir !== ".system" ? skillDir : undefined;
}

function formatExplorationLines(
	calls: ExecExplorationCall[],
): ExplorationLine[] {
	const lines: ExplorationLine[] = [];
	const reads = new Map<string, string>();
	const flushReads = () => {
		if (!reads.size) return;
		const duplicateLabels = new Set<string>();
		const seenLabels = new Set<string>();
		for (const label of reads.values()) {
			if (seenLabels.has(label)) duplicateLabels.add(label);
			seenLabels.add(label);
		}
		const labels = Array.from(reads, ([path, label]) =>
			duplicateLabels.has(label) ? path : label,
		);
		lines.push({ title: "Read", body: labels.join(", ") });
		reads.clear();
	};

	for (const { actions, command, outcome } of calls) {
		if (!outcome && actions.every((action) => action.kind === "read")) {
			for (const action of actions) {
				if (!reads.has(action.path))
					reads.set(action.path, formatReadLabel(action));
			}
			continue;
		}
		flushReads();
		const callLines = actions.map(formatActionLine);
		const last = callLines.at(-1);
		if (last && outcome) {
			last.outcome = outcome;
			last.compound = callLines.length > 1;
		} else if (outcome) {
			callLines.push({
				title: "Run",
				body: formatCommandPreview(command) ?? command,
				outcome,
			});
		}
		lines.push(...callLines);
	}
	flushReads();
	return lines;
}
