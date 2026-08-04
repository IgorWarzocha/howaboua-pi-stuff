import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderExecCommandCall, renderGroupedExecCommandCall } from "../../ui/tool-rendering/codex-rendering.ts";
import type { ExecCommandTracker } from "./command-state.ts";
import { formatUnifiedExecResult } from "./format.ts";
import { renderTerminalOutput } from "./output.ts";
import type { ExecSessionManager, UnifiedExecResult } from "./session-manager.ts";
import { MAX_EXEC_YIELD_TIME_MS } from "./shell.ts";

const EXEC_COMMAND_PARAMETERS = Type.Object({
	cmd: Type.String({ description: "Raw command string interpreted by the current shell; do not quote the entire command" }),
	workdir: Type.Optional(Type.String({ description: "Cwd" })),
	shell: Type.Optional(Type.String()),
	tty: Type.Optional(Type.Boolean({ description: "Keep stdin open for input or interruption" })),
	yield_time_ms: Type.Optional(Type.Number({ description: "Wait ms" })),
	max_output_tokens: Type.Optional(Type.Number({ description: "Truncate" })),
	login: Type.Optional(Type.Boolean({ description: "Login shell" })),
});

interface ExecCommandParams {
	cmd: string;
	workdir?: string | undefined;
	shell?: string | undefined;
	tty?: boolean | undefined;
	yield_time_ms?: number | undefined;
	max_output_tokens?: number | undefined;
	login?: boolean | undefined;
}

interface ExecCommandToolOptions {
	customRendering?: boolean | undefined;
	promptSnippet?: boolean | undefined;
	showOutputWhenCollapsed?: boolean | undefined;
}

interface ExecCommandRenderContextLike {
	toolCallId?: string | undefined;
	expanded?: boolean | undefined;
	args?: { cmd?: unknown } | undefined;
	invalidate?: () => void | undefined;
}

function prepareExecCommandArguments(args: unknown): ExecCommandParams {
	if (!args || typeof args !== "object") return args as ExecCommandParams;
	const prepared = { ...(args as Record<string, unknown>) };
	if (!("cmd" in prepared) && "command" in prepared) prepared["cmd"] = prepared["command"]!;
	if (!("workdir" in prepared)) {
		if ("cwd" in prepared) prepared["workdir"] = prepared["cwd"]!;
		else if ("working_directory" in prepared) prepared["workdir"] = prepared["working_directory"]!;
	}
	return prepared as unknown as ExecCommandParams;
}

function parseExecCommandParams(params: unknown): ExecCommandParams {
	if (!params || typeof params !== "object") throw new Error("exec_command requires an object parameter");
	const cmd = "cmd" in params ? params.cmd : undefined;
	if (typeof cmd !== "string") throw new Error("exec_command requires a string 'cmd' parameter");
	return {
		cmd,
		workdir: "workdir" in params && typeof params.workdir === "string" ? params.workdir : undefined,
		shell: "shell" in params && typeof params.shell === "string" ? params.shell : undefined,
		tty: "tty" in params && typeof params.tty === "boolean" ? params.tty : undefined,
		yield_time_ms: "yield_time_ms" in params && typeof params.yield_time_ms === "number" ? params.yield_time_ms : undefined,
		max_output_tokens: "max_output_tokens" in params && typeof params.max_output_tokens === "number" ? params.max_output_tokens : undefined,
		login: "login" in params && typeof params.login === "boolean" ? params.login : undefined,
	};
}

function isUnifiedExecResult(details: unknown): details is UnifiedExecResult {
	return typeof details === "object" && details !== null && typeof (details as { output?: unknown }).output === "string";
}

const COLLAPSED_OUTPUT_MAX_VISUAL_LINES = 5;
const COLLAPSED_OUTPUT_MAX_RAW_CHARS = 16_000;
const COLLAPSED_OUTPUT_MAX_RAW_LINES = 160;
type CollapsedExecOutput = Pick<UnifiedExecResult, "output"> & Partial<Pick<UnifiedExecResult, "exit_code" | "session_id" | "wall_time_seconds">>;

function expandHint(): string {
	try {
		return keyHint("app.tools.expand", "to expand");
	} catch {
		return "ctrl+o to expand";
	}
}

function collapsedOutput(result: CollapsedExecOutput, theme: { fg(role: string, text: string): string }): { text: string; truncated: boolean } {
	let output = renderTerminalOutput(result.output).trimEnd();
	let truncated = false;
	if (output.length > COLLAPSED_OUTPUT_MAX_RAW_CHARS) {
		output = output.slice(-COLLAPSED_OUTPUT_MAX_RAW_CHARS);
		const newline = output.indexOf("\n");
		if (newline !== -1) output = output.slice(newline + 1);
		truncated = true;
	}
	const lines = output.split("\n");
	if (lines.length > COLLAPSED_OUTPUT_MAX_RAW_LINES) {
		output = lines.slice(-COLLAPSED_OUTPUT_MAX_RAW_LINES).join("\n");
		truncated = true;
	}
	const parts = [output];
	if (result.session_id !== undefined) parts.push(theme.fg("accent", `Session ${result.session_id} still running`));
	if (result.exit_code !== undefined && result.exit_code !== 0) parts.push(theme.fg("muted", `Exit code: ${result.exit_code}`));
	if (typeof result.wall_time_seconds === "number" && parts.some(Boolean)) parts.push(theme.fg("muted", `Took ${result.wall_time_seconds.toFixed(1)}s`));
	return { text: parts.filter(Boolean).join("\n"), truncated };
}

function renderCollapsedOutput(result: CollapsedExecOutput, theme: { fg(role: string, text: string): string }) {
	let cached: { width: number; lines: string[]; skipped: number; rawTruncated: boolean } | undefined;
	return {
		render(width: number): string[] {
			if (!cached || cached.width !== width) {
				const output = collapsedOutput(result, theme);
				const preview = output.text
					? truncateToVisualLines(theme.fg("dim", output.text), COLLAPSED_OUTPUT_MAX_VISUAL_LINES, width, 4)
					: { visualLines: [], skippedCount: 0 };
				cached = { width, lines: preview.visualLines, skipped: preview.skippedCount, rawTruncated: output.truncated };
			}
			if (!cached.rawTruncated && cached.skipped <= 0) return cached.lines;
			const hint = cached.rawTruncated ? "... (earlier output hidden," : `... (${cached.skipped} earlier lines,`;
			return [truncateToWidth(`    ${theme.fg("muted", hint)} ${expandHint()}${theme.fg("muted", ")")}`, width, "..."), ...cached.lines];
		},
		invalidate(): void { cached = undefined; },
	};
}

function renderCall(
	args: { cmd?: unknown },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
) {
	const command = typeof args.cmd === "string" ? args.cmd : "";
	tracker.registerRenderContext(context?.toolCallId, context?.invalidate ?? (() => {}));
	const info = tracker.getRenderInfo(context?.toolCallId, command);
	if (info.hidden) return new Text("", 0, 0);
	const text = info.actionGroups
		? renderGroupedExecCommandCall(info.actionGroups, info.status, theme)
		: renderExecCommandCall(command, info.status, theme);
	return new Text(text, 0, 0);
}

function renderResult(
	result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
	renderOptions: { expanded: boolean; isPartial: boolean },
	theme: { fg(role: string, text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
	options: ExecCommandToolOptions,
) {
	const command = typeof context?.args?.cmd === "string" ? context.args.cmd : "";
	if (tracker.getRenderInfo(context?.toolCallId, command).hidden) return new Container();
	const details = isUnifiedExecResult(result.details) ? result.details : undefined;
	const textContent = result.content.find((item) => item.type === "text");
	const plainText = textContent?.text ?? "";
	if (!renderOptions.expanded) {
		const collapsed = details ?? (plainText ? { output: plainText } : undefined);
		return options.showOutputWhenCollapsed && collapsed ? renderCollapsedOutput(collapsed, theme) : new Container();
	}
	let text = theme.fg("dim", renderTerminalOutput(details?.output ?? plainText) || "(no output)");
	if (details?.session_id !== undefined) text += `\n${theme.fg("accent", `Session ${details.session_id} still running`)}`;
	if (details?.exit_code !== undefined) text += `\n${theme.fg("muted", `Exit code: ${details.exit_code}`)}`;
	return new Text(text, 4, 0);
}

export function createExecCommandTool(tracker: ExecCommandTracker, sessions: ExecSessionManager, options: ExecCommandToolOptions = {}) {
	const tool: Parameters<ExtensionAPI["registerTool"]>[0] = {
		name: "exec_command",
		label: "exec_command",
		description: "Run shell commands; may return session_id",
		...(options.promptSnippet === false ? {} : { promptSnippet: "Run command" }),
		parameters: EXEC_COMMAND_PARAMETERS,
		prepareArguments: prepareExecCommandArguments,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("exec_command aborted");
			const input = parseExecCommandParams(params);
			const toToolResult = (partial: UnifiedExecResult) => ({
				content: [{ type: "text" as const, text: formatUnifiedExecResult(partial, input.cmd) }],
				details: partial,
			});
			const execInput = input.tty
				? input
				: { ...input, max_yield_time_ms: MAX_EXEC_YIELD_TIME_MS };
			const result = await sessions.exec(execInput, ctx.cwd, signal, onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined);
			if (result.session_id !== undefined) tracker.recordPersistentSession(toolCallId, result.session_id);
			return toToolResult(result);
		},
		...(options.customRendering === false ? {} : {
			renderCall: ((args: { cmd?: unknown }, theme: { fg(role: string, text: string): string; bold(text: string): string }, context?: ExecCommandRenderContextLike) => renderCall(args, theme, context, tracker)) as never,
			renderResult: ((result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown }, renderOptions: { expanded: boolean; isPartial: boolean }, theme: { fg(role: string, text: string): string }, context?: ExecCommandRenderContextLike) => renderResult(result, renderOptions, theme, context, tracker, options)) as never,
		}),
	};
	return tool;
}

export function registerExecCommandTool(pi: ExtensionAPI, tracker: ExecCommandTracker, sessions: ExecSessionManager, options: ExecCommandToolOptions = {}): void {
	pi.registerTool(createExecCommandTool(tracker, sessions, options) as never);
}
