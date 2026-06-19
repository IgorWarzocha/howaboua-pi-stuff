import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";
import { keyHint, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { renderExecCommandCall, renderGroupedExecCommandCall } from "../../ui/tool-rendering/codex-rendering.ts";
import type { ExecCommandTracker } from "./command-state.ts";
import type { ExecSessionManager, UnifiedExecResult } from "./session-manager.ts";
import { formatUnifiedExecResult } from "./format.ts";
import { convertPathToolExecResult, getCodexBackedPathToolNames, getPathToolPolicy, imageContentsFromPathToolDetails, viewImageDescriptionFromPathToolDetails } from "../path/outputs.ts";
import { renderTextWithImages } from "../path/rendering.ts";
import { extractPathApplyPatchPreviewPlan, getPathApplyPatchRenderState, markPathApplyPatchPreviewExit, setPathApplyPatchPreviewState, type PathApplyPatchRenderSegment } from "../path/apply-patch-preview.ts";
import { renderPathToolCommandCall } from "../path/render-call.ts";
import { webRunSessionStatePath } from "../web-run/tool.ts";
import { resolveImageDescriptionModel } from "../view-image/tool.ts";
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
	return typeof details === "object" && details !== null && typeof (details as { output?: unknown }).output === "string";
}

function createEmptyResultComponent(): Container {
	return new Container();
}

async function resolveCodexBackedPathToolEnv(command: string, ctx: ExtensionContext, options: { includeViewImageDescription?: boolean | undefined } = {}): Promise<NodeJS.ProcessEnv | undefined> {
	const toolNames = getCodexBackedPathToolNames(command, options);
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
	cwd?: string | undefined;
	expanded?: boolean | undefined;
	args?: { workdir?: unknown; cwd?: unknown; working_directory?: unknown } | undefined;
	invalidate?: () => void | undefined;
}

interface ExecCommandToolOptions {
	customRendering?: boolean | undefined;
	promptSnippet?: boolean | undefined;
	showOutputWhenCollapsed?: boolean | undefined;
	compactTools?: boolean | undefined;
	describeImagesForTextModels?: boolean | undefined;
}

const COLLAPSED_OUTPUT_MAX_VISUAL_LINES = 5;
const COLLAPSED_OUTPUT_MAX_RAW_CHARS = 16_000;
const COLLAPSED_OUTPUT_MAX_RAW_LINES = 160;

type CollapsedExecOutput = Pick<UnifiedExecResult, "output"> & Partial<Pick<UnifiedExecResult, "exit_code" | "session_id" | "wall_time_seconds">>;

interface CollapsedExecOutputRenderState {
	cachedLines?: string[] | undefined;
	cachedSkipped?: number | undefined;
	cachedWidth?: number | undefined;
	cachedRawTruncated?: boolean | undefined;
}

interface CollapsedExecOutputText {
	text: string;
	rawTruncated: boolean;
}

function formatDuration(seconds: number): string {
	return `${seconds.toFixed(1)}s`;
}

function resolveExecCommandWorkdir(cwd: string, workdir: string | undefined): string {
	return workdir ? resolve(cwd, workdir) : cwd;
}

function resolveRenderWorkdir(args: { workdir?: unknown; cwd?: unknown; working_directory?: unknown }, context: ExecCommandRenderContextLike | undefined): string {
	const baseCwd = typeof context?.cwd === "string" && context.cwd ? context.cwd : process.cwd();
	const workdir = typeof args.workdir === "string"
		? args.workdir
		: typeof args.cwd === "string"
			? args.cwd
			: typeof args.working_directory === "string"
				? args.working_directory
				: typeof context?.args?.workdir === "string"
					? context.args.workdir
					: typeof context?.args?.cwd === "string"
						? context.args.cwd
						: typeof context?.args?.working_directory === "string"
							? context.args.working_directory
							: undefined;
	return resolveExecCommandWorkdir(baseCwd, workdir);
}

function expandHint(): string {
	try {
		return keyHint("app.tools.expand", "to expand");
	} catch {
		return "ctrl+o to expand";
	}
}

function tailCollapsedOutput(output: string): { output: string; truncated: boolean } {
	let text = output.trimEnd();
	let truncated = false;
	if (text.length > COLLAPSED_OUTPUT_MAX_RAW_CHARS) {
		text = text.slice(-COLLAPSED_OUTPUT_MAX_RAW_CHARS);
		truncated = true;
		const firstNewline = text.indexOf("\n");
		if (firstNewline !== -1) text = text.slice(firstNewline + 1);
	}
	const lines = text.split("\n");
	if (lines.length > COLLAPSED_OUTPUT_MAX_RAW_LINES) {
		text = lines.slice(-COLLAPSED_OUTPUT_MAX_RAW_LINES).join("\n");
		truncated = true;
	}
	return { output: text, truncated };
}

function formatCollapsedOutput(result: CollapsedExecOutput, theme: { fg(role: string, text: string): string }): CollapsedExecOutputText {
	const tail = tailCollapsedOutput(result.output);
	const lines = [tail.output];
	if (result.session_id !== undefined) lines.push(theme.fg("accent", `Session ${result.session_id} still running`));
	if (result.exit_code !== undefined && result.exit_code !== 0) lines.push(theme.fg("muted", `Exit code: ${result.exit_code}`));
	if (typeof result.wall_time_seconds === "number" && lines.some((line) => line.length > 0)) lines.push(theme.fg("muted", `Took ${formatDuration(result.wall_time_seconds)}`));
	return { text: lines.filter((line) => line.length > 0).join("\n"), rawTruncated: tail.truncated };
}

function renderCollapsedExecOutputPreview(result: CollapsedExecOutput, theme: { fg(role: string, text: string): string }) {
	const state: CollapsedExecOutputRenderState = {};
	return {
		render(width: number): string[] {
			if (state.cachedLines === undefined || state.cachedWidth !== width) {
				const output = formatCollapsedOutput(result, theme);
				if (!output.text) return [];
				const preview = truncateToVisualLines(theme.fg("dim", output.text), COLLAPSED_OUTPUT_MAX_VISUAL_LINES, width, 4);
				state.cachedLines = preview.visualLines;
				state.cachedSkipped = preview.skippedCount;
				state.cachedRawTruncated = output.rawTruncated;
				state.cachedWidth = width;
			}
			const rawTruncated = state.cachedRawTruncated === true;
			const skipped = state.cachedSkipped ?? 0;
			if (!rawTruncated && skipped <= 0) return state.cachedLines ?? [];
			const hintText = rawTruncated ? "... (earlier output hidden," : `... (${skipped} earlier lines,`;
			const hint = `    ${theme.fg("muted", hintText)} ${expandHint()}${theme.fg("muted", ")")}`;
			return [truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
		},
		invalidate(): void {
			state.cachedLines = undefined;
			state.cachedSkipped = undefined;
			state.cachedRawTruncated = undefined;
			state.cachedWidth = undefined;
		},
	};
}

function renderPathApplyPatchSegments(
	segments: PathApplyPatchRenderSegment[],
	status: Parameters<typeof renderExecCommandCall>[1],
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	options: { failed?: boolean | undefined; expanded?: boolean | undefined; compactTools?: boolean | undefined } = {},
): string | undefined {
	const text = segments
		.map((segment) => segment.kind === "patch"
			? options.failed && !options.expanded ? renderExecCommandCall("apply_patch", status, theme) : options.expanded ? segment.expanded : options.compactTools ? segment.summary : segment.collapsed
			: renderExecCommandCall(segment.command, status, theme))
		.filter((value) => value.trim().length > 0)
		.join("\n");
	return text.trim().length > 0 ? text : undefined;
}

const renderExecCommandCallWithOptionalContext: any = (
	args: { cmd?: unknown | undefined; workdir?: unknown; cwd?: unknown; working_directory?: unknown },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
	options: ExecCommandToolOptions = {},
) => {
	const command = typeof args.cmd === "string" ? args.cmd : "";
	tracker.registerRenderContext(context?.toolCallId, context?.invalidate ?? (() => {}));
	const renderInfo = tracker.getRenderInfo(context?.toolCallId, command);
	if (renderInfo.hidden) {
		return new Text("", 0, 0);
	}
	const pathApplyPatchPlan = extractPathApplyPatchPreviewPlan(command, resolveRenderWorkdir(args, context));
	if (pathApplyPatchPlan) {
		const pathApplyPatchState = getPathApplyPatchRenderState(context?.toolCallId);
		const failed = pathApplyPatchState?.exitCode !== undefined && pathApplyPatchState.exitCode !== 0;
		const text = renderPathApplyPatchSegments(pathApplyPatchState?.segments ?? pathApplyPatchPlan.segments, renderInfo.status, theme, { failed, expanded: context?.expanded, compactTools: options.compactTools });
		return text ? new Text(text, 0, 0) : new Text(renderExecCommandCall(command, renderInfo.status, theme), 0, 0);
	}
	const pathToolCall = renderPathToolCommandCall(command, theme, renderInfo.status);
	if (pathToolCall) return new Text(pathToolCall, 0, 0);
	const text = renderInfo.actionGroups
		? renderGroupedExecCommandCall(renderInfo.actionGroups, renderInfo.status, theme)
		: renderExecCommandCall(command, renderInfo.status, theme);
	return new Text(text, 0, 0);
};

const renderExecCommandResultWithOptionalContext: any = (
	result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
	_options: { expanded: boolean; isPartial: boolean },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	context: ExecCommandRenderContextLike | undefined,
	tracker: ExecCommandTracker,
	options: ExecCommandToolOptions = {},
) => {
	const command = context && "args" in context && context.args && typeof (context as any).args.cmd === "string" ? (context as any).args.cmd : undefined;
	if (tracker.getRenderInfo(context?.toolCallId, command ?? "").hidden) {
		return createEmptyResultComponent();
	}

	const details = isUnifiedExecResult(result.details) ? result.details : undefined;
	const textContent = result.content.find((item) => item.type === "text");
	const textOutput = textContent?.type === "text" ? textContent.text ?? "" : "";
	if (!_options.expanded) {
		const compactImages = result.content.some((item) => item.type === "image") ? result.content : imageContentsFromPathToolDetails(details);
		if (compactImages.some((item) => item.type === "image")) return renderTextWithImages(theme.fg("dim", viewImageDescriptionFromPathToolDetails(details) ?? ""), compactImages, theme, { paddingX: 4 });
		const pathApplyPatchState = getPathApplyPatchRenderState(context?.toolCallId);
		if (pathApplyPatchState && details?.exit_code !== undefined && details.exit_code !== 0) {
			return renderCollapsedExecOutputPreview(details, theme);
		}
		if (pathApplyPatchState) {
			return createEmptyResultComponent();
		}
		const collapsedResult = details ?? (textOutput ? { output: textOutput } : undefined);
		return options.showOutputWhenCollapsed && collapsedResult ? renderCollapsedExecOutputPreview(collapsedResult, theme) : createEmptyResultComponent();
	}

	const output = details?.output ?? (textContent?.type === "text" ? textContent.text : "");
	let text = theme.fg("dim", output || "(no output)");
	if (details?.session_id !== undefined) {
		text += `\n${theme.fg("accent", `Session ${details.session_id} still running`)}`;
	}
	if (details?.exit_code !== undefined) {
		text += `\n${theme.fg("muted", `Exit code: ${details.exit_code}`)}`;
	}
	const renderContent = result.content.some((item) => item.type === "image") ? result.content : [...result.content, ...imageContentsFromPathToolDetails(details)];
	return renderTextWithImages(text, renderContent, theme, { paddingX: 4 });
};

export function registerExecCommandTool(pi: ExtensionAPI, tracker: ExecCommandTracker, sessions: ExecSessionManager, options: ExecCommandToolOptions = {}): void {
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
			const pathToolPolicy = getPathToolPolicy(typedParams.cmd, ctx.model, { describeImages: options.describeImagesForTextModels });
			if (pathToolPolicy?.unsupportedMessage) throw new Error(pathToolPolicy.unsupportedMessage);
			if (pathToolPolicy?.parseApplyPatchOutput) {
				setPathApplyPatchPreviewState(toolCallId, typedParams.cmd, resolveExecCommandWorkdir(ctx.cwd, typedParams.workdir));
			}
			const webRunStatePath = pathToolPolicy?.parseWebRunOutput ? webRunSessionStatePath(ctx) : undefined;
			const describeImagesForTextModel = options.describeImagesForTextModels && !(Array.isArray(ctx.model?.input) && ctx.model.input.includes("image"));
			const codexBackedPathToolEnv = await resolveCodexBackedPathToolEnv(typedParams.cmd, ctx, { includeViewImageDescription: describeImagesForTextModel });
			const hasViewImageDescriptionCommand = getCodexBackedPathToolNames(typedParams.cmd, { includeViewImageDescription: true }).includes("view_image");
			const viewImageDescriptionEnv = describeImagesForTextModel && hasViewImageDescriptionCommand
				? { PI_CODEX_VIEW_IMAGE_DESCRIBE: "1", PI_CODEX_VIEW_IMAGE_MODEL: resolveImageDescriptionModel(ctx), ...(pathToolPolicy?.describeImageOutput ? { PI_CODEX_VIEW_IMAGE_STRUCTURED: "1" } : {}) }
				: undefined;
			const pathToolEnv = webRunStatePath || codexBackedPathToolEnv || viewImageDescriptionEnv ? { ...codexBackedPathToolEnv, ...viewImageDescriptionEnv, ...(webRunStatePath ? { PI_WEB_RUN_STATE_PATH: webRunStatePath } : {}) } : undefined;
			const execParams = pathToolPolicy
				? {
					...typedParams,
					...(pathToolEnv ? { env: pathToolEnv } : {}),
					...(pathToolPolicy.disableTruncation ? { max_output_tokens: Number.MAX_SAFE_INTEGER } : {}),
					...(pathToolPolicy.yieldTimeMs !== undefined ? { yield_time_ms: pathToolPolicy.yieldTimeMs, max_yield_time_ms: pathToolPolicy.yieldTimeMs } : {}),
				}
				: pathToolEnv ? { ...typedParams, env: pathToolEnv } : typedParams;
			const result = await sessions.exec(execParams, ctx.cwd, signal, pathToolPolicy?.suppressPartials ? undefined : onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined);
			if (pathToolPolicy?.parseApplyPatchOutput) {
				markPathApplyPatchPreviewExit(toolCallId, result.exit_code);
			}
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
			renderExecCommandCallWithOptionalContext(args, theme, context, tracker, options)) as any,
			renderResult: ((
			result: { content: Array<{ type: string; text?: string | undefined }>; details?: unknown | undefined },
			renderOptions: { expanded: boolean; isPartial: boolean },
			theme: { fg(role: string, text: string): string; bold(text: string): string },
			context?: ExecCommandRenderContextLike,
		) => renderExecCommandResultWithOptionalContext(result, renderOptions, theme, context, tracker, options)) as any,
		}),
	});
}
