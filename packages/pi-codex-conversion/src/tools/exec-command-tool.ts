import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { renderExecCommandCall, renderGroupedExecCommandCall } from "./codex-rendering.ts";
import type { ExecCommandTracker } from "./exec-command-state.ts";
import type { ExecSessionManager, UnifiedExecResult } from "./exec-session-manager.ts";
import { formatUnifiedExecResult } from "./unified-exec-format.ts";

const EXEC_COMMAND_PARAMETERS = Type.Object({
	cmd: Type.String({ description: "Shell command to execute." }),
	workdir: Type.Optional(Type.String({ description: "Defaults to current cwd." })),
	shell: Type.Optional(Type.String({ description: "Defaults to the user's shell." })),
	tty: Type.Optional(
		Type.Boolean({
			description: "Allocate a TTY. Defaults to false.",
		}),
	),
	yield_time_ms: Type.Optional(Type.Number({ description: "Wait before yielding. Max 30000." })),
	max_output_tokens: Type.Optional(Type.Number({ description: "Truncate excess output." })),
	login: Type.Optional(Type.Boolean({ description: "Whether to run through a login-style shell so user PATH/toolchain setup is loaded. Defaults to true." })),
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

function prepareExecCommandArguments(args: unknown): ExecCommandParams {
	if (!args || typeof args !== "object") {
		return args as ExecCommandParams;
	}

	const record = args as Record<string, unknown>;
	const prepared: Record<string, unknown> = { ...record };
	if (!("cmd" in prepared) && "command" in prepared) {
		prepared["cmd"] = prepared["command"]!;
	}
	if (!("workdir" in prepared)) {
		if ("cwd" in prepared) {
			prepared["workdir"] = prepared["cwd"]!;
		} else if ("working_directory" in prepared) {
			prepared["workdir"] = prepared["working_directory"]!;
		}
	}
	return prepared as unknown as ExecCommandParams;
}

function parseExecCommandParams(params: unknown): ExecCommandParams {
	if (!params || typeof params !== "object") {
		throw new Error("exec_command requires an object parameter");
	}

	const cmd = "cmd" in params ? params.cmd : undefined;
	if (typeof cmd !== "string") {
		throw new Error("exec_command requires a string 'cmd' parameter");
	}

	return {
		cmd,
		workdir: "workdir" in params && typeof params.workdir === "string" ? params.workdir : undefined,
		shell: "shell" in params && typeof params.shell === "string" ? params.shell : undefined,
		tty: "tty" in params && typeof params.tty === "boolean" ? params.tty : undefined,
		yield_time_ms: "yield_time_ms" in params && typeof params.yield_time_ms === "number" ? params.yield_time_ms : undefined,
		max_output_tokens:
			"max_output_tokens" in params && typeof params.max_output_tokens === "number" ? params.max_output_tokens : undefined,
		login: "login" in params && typeof params.login === "boolean" ? params.login : undefined,
	};
}

function isUnifiedExecResult(details: unknown): details is UnifiedExecResult {
	return typeof details === "object" && details !== null;
}

function createEmptyResultComponent(): Container {
	return new Container();
}

interface ExecCommandRenderContextLike {
	toolCallId?: string | undefined;
	invalidate?: () => void | undefined;
}

const renderExecCommandCallWithOptionalContext: any = (
	args: { cmd?: unknown | undefined },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
) => {
	const command = typeof args.cmd === "string" ? args.cmd : "";
	tracker.registerRenderContext(context?.toolCallId, context?.invalidate ?? (() => {}));
	const renderInfo = tracker.getRenderInfo(context?.toolCallId, command);
	if (renderInfo.hidden) {
		return new Text("", 0, 0);
	}
	const text = renderInfo.actionGroups
		? renderGroupedExecCommandCall(renderInfo.actionGroups, renderInfo.status, theme)
		: renderExecCommandCall(command, renderInfo.status, theme);
	return new Text(text, 0, 0);
};

const renderExecCommandResultWithOptionalContext: any = (
	result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
	options: { expanded: boolean; isPartial: boolean },
	theme: { fg(role: string, text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
) => {
	if (!options.expanded) {
		return createEmptyResultComponent();
	}

	const command = context && "args" in context && context.args && typeof (context as any).args.cmd === "string" ? (context as any).args.cmd : undefined;
	if (tracker.getRenderInfo(context?.toolCallId, command ?? "").hidden) {
		return createEmptyResultComponent();
	}

	const details = isUnifiedExecResult(result.details) ? result.details : undefined;
	const content = result.content.find((item) => item.type === "text");
	const output = details?.output ?? (content?.type === "text" ? content.text : "");
	let text = theme.fg("dim", output || "(no output)");
	if (details?.session_id !== undefined) {
		text += `\n${theme.fg("accent", `Session ${details.session_id} still running`)}`;
	}
	if (details?.exit_code !== undefined) {
		text += `\n${theme.fg("muted", `Exit code: ${details.exit_code}`)}`;
	}
	return new Text(text, 0, 0);
};

export function registerExecCommandTool(pi: ExtensionAPI, tracker: ExecCommandTracker, sessions: ExecSessionManager): void {
	pi.registerTool({
		name: "exec_command",
		label: "exec_command",
		description: "Runs a shell command, returning output or a session ID for ongoing interaction.",
		promptSnippet: "Run a command.",
		parameters: EXEC_COMMAND_PARAMETERS,
		prepareArguments: prepareExecCommandArguments as (args: unknown) => { cmd: string; workdir?: string; shell?: string; tty?: boolean; yield_time_ms?: number; max_output_tokens?: number; login?: boolean },
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("exec_command aborted");
			}
			const typedParams = parseExecCommandParams(params);
			const toToolResult = (partial: UnifiedExecResult) => ({
				content: [{ type: "text" as const, text: formatUnifiedExecResult(partial, typedParams.cmd) }],
				details: partial,
			});
			const result = await sessions.exec(typedParams, ctx.cwd, signal, onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined);
			if (result.session_id !== undefined) {
				tracker.recordPersistentSession(toolCallId, result.session_id);
			}
			return {
				content: [{ type: "text", text: formatUnifiedExecResult(result, typedParams.cmd) }],
				details: result,
			};
		},
		renderCall: ((args: { cmd?: unknown | undefined }, theme: { fg(role: string, text: string): string; bold(text: string): string }, context?: ExecCommandRenderContextLike) =>
			renderExecCommandCallWithOptionalContext(args, theme, context, tracker)) as any,
		renderResult: ((
			result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
			options: { expanded: boolean; isPartial: boolean },
			theme: { fg(role: string, text: string): string },
			context?: ExecCommandRenderContextLike,
		) => renderExecCommandResultWithOptionalContext(result, options, theme, context, tracker)) as any,
	});
}
