import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { renderExecCommandCall, renderGroupedExecCommandCall } from "../../ui/tool-rendering/codex-rendering.ts";
import type { ExecCommandTracker } from "./command-state.ts";
import type { ExecSessionManager, UnifiedExecResult } from "./session-manager.ts";
import { formatUnifiedExecResult } from "./format.ts";
import { convertPathToolExecResult, getCodexBackedPathToolNames, getPathToolPolicy } from "../path/outputs.ts";
import { renderTextWithImages } from "../path/rendering.ts";
import { webRunSessionStatePath } from "../web-run/tool.ts";
import { codexToolProviderEnv, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.ts";
export { imageContentFromCodexViewImageOutput, imageContentsFromCodexViewImageOutput } from "../path/outputs.ts";

const EXEC_COMMAND_PARAMETERS = Type.Object({
	cmd: Type.String(),
	workdir: Type.Optional(Type.String({ description: "Cwd." })),
	shell: Type.Optional(Type.String()),
	tty: Type.Optional(
		Type.Boolean({
			description: "TTY.",
		}),
	),
	yield_time_ms: Type.Optional(Type.Number({ description: "Wait ms." })),
	max_output_tokens: Type.Optional(Type.Number({ description: "Truncate." })),
	login: Type.Optional(Type.Boolean({ description: "Login shell." })),
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

async function resolveCodexBackedPathToolEnv(command: string, ctx: ExtensionContext): Promise<NodeJS.ProcessEnv | undefined> {
	const toolNames = getCodexBackedPathToolNames(command);
	if (toolNames.length === 0) return undefined;
	try {
		const env = codexToolProviderEnv(await resolveCodexToolProvider(ctx));
		return {
			PI_CODEX_ACCESS_TOKEN: env["PI_CODEX_ACCESS_TOKEN"],
			PI_CODEX_ACCOUNT_ID: env["PI_CODEX_ACCOUNT_ID"],
			PI_CODEX_BASE_URL: env["PI_CODEX_BASE_URL"],
			PI_CODEX_RESPONSES_URL: env["PI_CODEX_RESPONSES_URL"],
			...(env["PI_CODEX_MODEL"] ? { PI_CODEX_MODEL: env["PI_CODEX_MODEL"] } : {}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${toolNames.join("/")} requires Pi model auth: ${message}`);
	}
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
	_options: { expanded: boolean; isPartial: boolean },
	theme: { fg(role: string, text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
) => {
	if (!_options.expanded) {
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
	return renderTextWithImages(text, result.content, theme, { paddingX: 4 });
};

export function registerExecCommandTool(pi: ExtensionAPI, tracker: ExecCommandTracker, sessions: ExecSessionManager, options: { customRendering?: boolean | undefined; promptSnippet?: boolean | undefined } = {}): void {
	pi.registerTool({
		name: "exec_command",
		label: "exec_command",
		description: "Run shell commands; may return session_id.",
		...(options.promptSnippet === false ? {} : { promptSnippet: "Run command." }),
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
			const pathToolPolicy = getPathToolPolicy(typedParams.cmd, ctx.model);
			const webRunStatePath = pathToolPolicy?.parseWebRunOutput ? webRunSessionStatePath(ctx) : undefined;
			const codexBackedPathToolEnv = await resolveCodexBackedPathToolEnv(typedParams.cmd, ctx);
			const execParams = pathToolPolicy
				? {
					...typedParams,
					...(webRunStatePath || codexBackedPathToolEnv ? { env: { ...codexBackedPathToolEnv, ...(webRunStatePath ? { PI_WEB_RUN_STATE_PATH: webRunStatePath } : {}) } } : {}),
					...(pathToolPolicy.disableTruncation ? { max_output_tokens: Number.MAX_SAFE_INTEGER } : {}),
					...(pathToolPolicy.yieldTimeMs !== undefined ? { yield_time_ms: pathToolPolicy.yieldTimeMs, max_yield_time_ms: pathToolPolicy.yieldTimeMs } : {}),
				}
				: codexBackedPathToolEnv ? { ...typedParams, env: codexBackedPathToolEnv } : typedParams;
			const result = await sessions.exec(execParams, ctx.cwd, signal, pathToolPolicy?.suppressPartials ? undefined : onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined);
			if (result.session_id !== undefined) {
				tracker.recordPersistentSession(toolCallId, result.session_id);
			}
			const pathToolResult = convertPathToolExecResult(typedParams.cmd, result, pathToolPolicy);
			if (pathToolResult) return pathToolResult;
			return {
				content: [{ type: "text", text: formatUnifiedExecResult(result, typedParams.cmd) }],
				details: result,
			};
		},
		...(options.customRendering === false ? {} : {
			renderCall: ((args: { cmd?: unknown | undefined }, theme: { fg(role: string, text: string): string; bold(text: string): string }, context?: ExecCommandRenderContextLike) =>
			renderExecCommandCallWithOptionalContext(args, theme, context, tracker)) as any,
			renderResult: ((
			result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
			renderOptions: { expanded: boolean; isPartial: boolean },
			theme: { fg(role: string, text: string): string },
			context?: ExecCommandRenderContextLike,
		) => renderExecCommandResultWithOptionalContext(result, renderOptions, theme, context, tracker)) as any,
		}),
	});
}
