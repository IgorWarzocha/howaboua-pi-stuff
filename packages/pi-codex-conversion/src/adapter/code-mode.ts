import {
	getAgentDir,
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexExtensionRuntime } from "../extension/runtime.ts";
import { getCodeModeExtensionToolSnapshot } from "../code-mode-extension-tools.ts";
import {
	type CodeModeRegistration,
	registerCodeModeTools,
	registerCustomTools,
} from "../tools/code-mode/tools.ts";
import type { ProgrammaticCodeModeToolDefinition } from "../tools/code-mode/types.ts";
import { createApplyPatchTool } from "../tools/apply-patch/tool.ts";
import { createExecCommandTool } from "../tools/exec/command-tool.ts";
import { createWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { createViewImageTool } from "../tools/view-image/tool.ts";
import { supportsViewImageInputs } from "./tool-support.ts";
import {
	isCodeModeRuntime,
	resolveCodexRuntimePlanForState,
} from "./activation/runtime-plan.ts";
import {
	CODE_MODE_TOOL_NAMES,
	NOTEBOOK_MODE_TOOL_NAMES,
} from "./activation/tool-set.ts";
import {
	codeModeImageResult,
	toNestedTool,
} from "./code-mode/nested-tool-adapter.ts";
import { resolveProtectedOutputScope } from "../tools/code-mode/protected-output.ts";
import { appendRemoteDelivery } from "../tools/code-mode/protected-delivery.ts";
import { createPiCodeModeBridge } from "./code-mode/pi-tools.ts";
import { syncAdapter } from "./activation/activation.ts";

const LONG_RUNNING_TOOL_OUTER_YIELD_MS = 1_800_000;

export async function registerCodexCodeMode(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	beforePrepare?: (ctx: ExtensionContext) => void,
): Promise<CodeModeRegistration> {
	let latestContext: ExtensionContext | undefined;
	let stopped = false;
	let pendingNativeProjection = false;
	const piTools = createPiCodeModeBridge(pi);
	const isActive = (ctx: unknown) => {
		if (ctx) latestContext = ctx as ExtensionContext;
		const plan = resolveCodexRuntimePlanForState(
			ctx as ExtensionContext,
			runtime.state,
		);
		if (!isCodeModeRuntime(plan)) return false;
		const requiredTools =
			plan.kind === "ts" ? NOTEBOOK_MODE_TOOL_NAMES : CODE_MODE_TOOL_NAMES;
		const activeTools = pi.getActiveTools();
		return requiredTools.every((name) => activeTools.includes(name));
	};
	const customToolsRuntime = await registerCustomTools(pi, undefined, {
		isActive,
	});
	const programmaticRuntime = await registerCodeModeTools(pi, {
		prepareLoadout: (loadout) => {
			if (!latestContext) return undefined;
			const plan = resolveCodexRuntimePlanForState(
				latestContext,
				runtime.state,
			);
			if (!isCodeModeRuntime(plan)) return undefined;
			const required =
				plan.kind === "ts" ? NOTEBOOK_MODE_TOOL_NAMES : CODE_MODE_TOOL_NAMES;
			if (
				!required.every((name) =>
					loadout.declared.some((tool) => tool.name === name),
				)
			)
				return undefined;
			// MCP can activate native discovery after our preparation hook or during
			// a run. Reconcile outside Pi's synchronous loadout callback.
			const nativeSearch = pi
				.getAllTools()
				.some(
					(tool) =>
						tool.name === "tool_search" &&
						tool.sourceInfo?.path === "builtin:tool-search",
				);
			if (
				!pendingNativeProjection &&
				loadout.declared.some(
					(tool) =>
						tool.name === "codemode" ||
						(nativeSearch && tool.name === "tool_search"),
				)
			) {
				pendingNativeProjection = true;
				queueMicrotask(() => {
					pendingNativeProjection = false;
					if (
						!stopped &&
						latestContext &&
						isActive(latestContext) &&
						pi
							.getActiveTools()
							.some(
								(name) =>
									name === "codemode" ||
									(nativeSearch && name === "tool_search"),
							)
					)
						syncAdapter(pi, latestContext, runtime.state);
				});
			}
			return piTools.prepareLoadout(loadout, [
				"codemode",
				...(nativeSearch ? ["tool_search"] : []),
			]);
		},
		getTools: (ctx) => {
			const context = ctx as ExtensionContext | undefined;
			const extensions = getCodeModeExtensionToolSnapshot(pi, context, {
				eligibleTopLevelNames:
					runtime.state.previousToolNames ?? pi.getActiveTools(),
			});
			return [
				...createNestedTools(pi, runtime, context),
				...extensions.tools,
				...piTools.getTools(extensions.allToolNames),
			];
		},
		isActive,
		opaqueResultScope: (ctx) => resolveProtectedOutputScope(ctx),
		lazyOpaqueResultScope: () => true,
		deliverOpaqueResponse: (response, callId, scope, ctx) =>
			appendRemoteDelivery(pi, response, callId, scope, ctx),
		executionKind: (ctx) => {
			const kind = resolveCodexRuntimePlanForState(
				ctx as ExtensionContext,
				runtime.state,
			).kind;
			return kind === "ts" || kind === "vm" ? kind : "code";
		},
		notebookOptions: () => ({
			maxHeapMiB: runtime.state.config.notebook.maxHeapMiB,
			agentDir: getAgentDir(),
			...(runtime.state.config.notebook.profile
				? { profile: runtime.state.config.notebook.profile }
				: {}),
		}),
		providesRenderers: true,
		toolDetails: () => runtime.state.config.ui.toolDetails,
	});
	return {
		prepare: (ctx) => {
			if (ctx) beforePrepare?.(ctx as ExtensionContext);
			return programmaticRuntime.prepare(ctx);
		},
		getTools: (ctx) => programmaticRuntime.getTools(ctx),
		getPromptTools: (ctx) => programmaticRuntime.getPromptTools(ctx),
		notebookStatus: (ctx) => programmaticRuntime.notebookStatus(ctx),
		checkpointNotebook: () => programmaticRuntime.checkpointNotebook(),
		shutdownHost: () => programmaticRuntime.shutdownHost(),
		async shutdown() {
			stopped = true;
			latestContext = undefined;
			await programmaticRuntime.shutdown();
			await customToolsRuntime.shutdown();
		},
	};
}

function createNestedTools(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	ctx?: ExtensionContext,
): ProgrammaticCodeModeToolDefinition[] {
	const registeredToolNames = new Set(
		pi.getAllTools().map((tool) => tool.name),
	);
	const options = {
		describeImagesForTextModels: runtime.state.config.tools.viewImageFallback,
		promptSnippet: false,
		customRendering: runtime.state.config.ui.toolRenaming,
		showOutputWhenCollapsed: true,
	};
	const textOutput = runtime.state.config.notebook.plainCommandOutput
		? { textOutput: "plain-command" as const }
		: { textOutput: "command" as const };
	const tools: ProgrammaticCodeModeToolDefinition[] = [
		toNestedTool(
			createApplyPatchTool({
				customRustBinariesDir: runtime.state.config.tools.customRustBinariesDir,
				promptSnippet: false,
				showDiffWhenCollapsed:
					runtime.state.config.ui.toolDetails === "preview",
			}),
			"tools.apply_patch(patch)",
			{},
			{
				kind: "freeform",
				promptGuidelines: [
					"Wrap in *** Begin Patch / *** End Patch. Actions: *** Add File: path | *** Update File: path | *** Delete File: path",
					"*** Move to: path follows its Update File header immediately; include a nonempty @@ hunk (one unchanged context line for a pure move)",
					"Update hunks follow file order. Copy exact context; @@ text is context, not a line range. Reread changed files before patching",
					"One patch per file; split oversized patches serially. Batch independent files with Promise.allSettled",
					"Use for targeted edits. Reserve shell/Python for formatting and bulk rewrites",
				],
				prepareInput(input) {
					if (typeof input !== "string")
						throw new Error("apply_patch expects a patch string");
					return { input };
				},
				resultError(result) {
					if (
						result.details &&
						typeof result.details === "object" &&
						"status" in result.details &&
						result.details.status === "partial_failure"
					)
						return (
							result.content
								.filter((item) => item.type === "text")
								.map((item) => item.text)
								.join("\n") || "apply_patch partially failed"
						);
					return undefined;
				},
			},
		),
		toNestedTool(
			createExecCommandTool(runtime.tracker, runtime.sessions, options),
			"tools.exec_command({ cmd: string, workdir?: string, shell?: string, tty?: boolean, yield_time_ms?: number, max_output_tokens?: number, login?: boolean })",
			{
				start(id, input) {
					const cmd =
						input &&
						typeof input === "object" &&
						"cmd" in input &&
						typeof input.cmd === "string"
							? input.cmd
							: "";
					if (cmd) runtime.tracker.recordStart(id, cmd);
				},
				end: (id) => runtime.tracker.recordEnd(id),
			},
			{
				yieldTimeMs: LONG_RUNNING_TOOL_OUTER_YIELD_MS,
				promptGuidelines: [
					"Filter large output at the source",
					"Use tty=true for input and persistent processes",
					"Returns { output: string, session_id?: number, exit_code?: number }",
				],
				...textOutput,
				resultValue(result) {
					const details = result.details;
					if (result.content.some((item) => item.type === "image")) {
						const outputHint = isExecResult(details)
							? details.output
							: result.content
									.filter((item) => item.type === "text")
									.map((item) => item.text)
									.join("\n") || undefined;
						return codeModeImageResult(result, outputHint);
					}
					if (isExecResult(details)) return details;
					return (
						result.content
							.filter(
								(item): item is { type: "text"; text: string } =>
									item.type === "text",
							)
							.map((item) => item.text)
							.join("\n") || "(no output)"
					);
				},
			},
		),
		toNestedTool(
			createWriteStdinTool(runtime.sessions, options),
			"tools.write_stdin({ session_id: number, chars?: string, yield_time_ms?: number, max_output_tokens?: number })",
			{},
			{
				yieldTimeMs: LONG_RUNNING_TOOL_OUTER_YIELD_MS,
				promptGuidelines: [
					"Nonempty chars require tty=true on the original tools.exec_command call",
				],
				...textOutput,
			},
		),
	];
	if (
		!ctx ||
		supportsViewImageInputs(ctx.model) ||
		runtime.state.config.tools.viewImageFallback
	) {
		const imageCapable = !ctx || supportsViewImageInputs(ctx.model);
		tools.push(
			toNestedTool(
				createViewImageTool({
					customRustBinariesDir:
						runtime.state.config.tools.customRustBinariesDir,
					describeForTextModels: runtime.state.config.tools.viewImageFallback,
					promptSnippet: false,
					customRendering: runtime.state.config.ui.toolRenaming,
				}),
				imageCapable
					? 'tools.view_image({ path: string, detail?: "original" })'
					: "tools.view_image({ path: string })",
				{},
				imageCapable
					? {
							promptGuidelines: ["Pass the result to image()"],
							resultValue: codeModeImageResult,
						}
					: {},
			),
		);
	}
	if (
		ctx &&
		resolveCodexRuntimePlanForState(ctx, runtime.state).autoReasoning
	) {
		tools.push(
			toNestedTool(
				{
					...runtime.autoReasoning.tool,
					description: "Change reasoning effort",
				},
				'tools.change_reasoning({ level: "low" | "medium" | "high" | "xhigh" | "max" })',
				{},
				{ promptGuidelines: [runtime.autoReasoning.guidance()] },
			),
		);
	}
	return tools.filter((tool) => registeredToolNames.has(tool.name));
}

function isExecResult(
	details: AgentToolResult<unknown>["details"],
): details is Record<string, unknown> & { output: string } {
	return Boolean(
		details &&
		typeof details === "object" &&
		"output" in details &&
		typeof details.output === "string",
	);
}
