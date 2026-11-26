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
import { resolveAdapterRuntimePlanForState } from "./activation/runtime-plan.ts";
import {
	hasActiveExecTools,
	NESTED_ADAPTER_TOOL_NAMES,
	REPLACED_PI_TOOL_NAMES,
} from "./activation/tool-set.ts";
import {
	codeModeImageResult,
	toNestedTool,
} from "./code-mode/nested-tool-adapter.ts";
import { resolveProtectedOutputScope } from "../tools/code-mode/protected-output.ts";
import { appendRemoteDelivery } from "../tools/code-mode/protected-delivery.ts";
import { createPiCodeModeBridge } from "./code-mode/pi-tools.ts";
import { syncAdapter } from "./activation/activation.ts";
import { recordNativeNestedSelection } from "./activation/native-nested-selection.ts";

const LONG_RUNNING_TOOL_OUTER_YIELD_MS = 1_800_000;

export async function registerCodexCodeMode(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
): Promise<CodeModeRegistration> {
	let latestContext: ExtensionContext | undefined;
	let stopped = false;
	let pendingNativeProjection = false;
	let callableNames: ReadonlySet<string> = new Set();
	const piTools = createPiCodeModeBridge(pi);
	const isActive = (ctx: unknown) => {
		if (ctx) latestContext = ctx as ExtensionContext;
		const plan = resolveAdapterRuntimePlanForState(
			ctx as ExtensionContext,
			runtime.state,
		);
		return hasActiveExecTools(plan.kind, pi.getActiveTools());
	};
	const customToolsRuntime = await registerCustomTools(pi, undefined, {
		isActive,
	});
	const programmaticRuntime = await registerCodeModeTools(pi, {
		prepareLoadout: (loadout) => {
			callableNames = new Set(loadout.callable.map(({ name }) => name));
			if (
				!hasActiveExecTools(
					runtime.state.appliedRuntimeKind,
					loadout.declared.map(({ name }) => name),
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
				...REPLACED_PI_TOOL_NAMES,
				...NESTED_ADAPTER_TOOL_NAMES,
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
				...createNestedTools(
					runtime,
					context
						? callableNames
						: new Set(pi.getAllTools().map(({ name }) => name)),
					context,
				),
				...extensions.tools,
				...piTools.getTools(extensions.allToolNames),
			];
		},
		isActive,
		heavySystemPromptOverwrite: () =>
			runtime.state.config.prompt.heavySystemPromptOverwrite,
		opaqueResultScope: (ctx) => resolveProtectedOutputScope(ctx),
		lazyOpaqueResultScope: () => true,
		deliverOpaqueResponse: (response, callId, scope, ctx) =>
			appendRemoteDelivery(pi, response, callId, scope, ctx),
		executionKind: (ctx) => {
			const kind = resolveAdapterRuntimePlanForState(
				ctx as ExtensionContext,
				runtime.state,
			).kind;
			return kind === "ts" || kind === "vm" ? kind : "code";
		},
		executionClientOptions: () => ({
			maxHeapMiB: runtime.state.config.notebook.maxHeapMiB,
			agentDir: getAgentDir(),
			...(runtime.state.config.notebook.profile
				? { profile: runtime.state.config.notebook.profile }
				: {}),
		}),
		providesRenderers: true,
		toolDetails: () => runtime.state.config.ui.toolDetails,
	});
	pi.on("message_end", ({ message }, ctx) => {
		// Pi has already saved the system loadout, but not this new tree node.
		if ((message.role === "user" || message.role === "custom") && isActive(ctx))
			recordNativeNestedSelection(pi, ctx);
	});
	pi.on("session_shutdown", ({ reason }, ctx) => {
		// Reload keeps live edits. Only an empty selection is ambiguous before
		// its next saved turn. Marking an unsaved nonempty one would not save it.
		if (
			reason === "reload" &&
			isActive(ctx) &&
			!pi
				.getActiveTools()
				.some((name) => NESTED_ADAPTER_TOOL_NAMES.includes(name))
		)
			recordNativeNestedSelection(pi, ctx);
	});
	return {
		prepare: programmaticRuntime.prepare,
		getTools: (ctx) => programmaticRuntime.getTools(ctx),
		getPromptTools: (ctx) => programmaticRuntime.getPromptTools(ctx),
		notebookStatus: (ctx) => programmaticRuntime.notebookStatus(ctx),
		vmBindingStatus: (ctx) => programmaticRuntime.vmBindingStatus(ctx),
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
	runtime: CodexExtensionRuntime,
	toolNames: ReadonlySet<string>,
	ctx?: ExtensionContext,
): ProgrammaticCodeModeToolDefinition[] {
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
			{
				pccHooks: true,
				kind: "freeform",
				promptGuidelines: [
					"Wrap in *** Begin Patch / *** End Patch. Actions: *** Add File: path | *** Update File: path | *** Delete File: path",
					"*** Move to: path follows its Update File header immediately; include a nonempty @@ hunk (one unchanged context line for a pure move)",
					"Update hunks MUST follow file order and MUST NOT overlap, including context; merge overlapping hunks. Copy exact context; @@ text is context, not a line range. Reread changed files before patching",
					"One patch per file; split oversized patches serially. Batch independent files with Promise.allSettled",
					"Use for targeted edits. Reserve shell/Python for formatting and bulk rewrites",
				],
				prepareInput(input) {
					if (typeof input !== "string")
						throw new Error("apply_patch expects a patch string");
					return { input };
				},
			},
		),
		toNestedTool(
			createExecCommandTool(runtime.tracker, runtime.sessions, options),
			"tools.exec_command({ cmd: string, workdir?: string, shell?: string, tty?: boolean, yield_time_ms?: number, max_output_tokens?: number, login?: boolean })",
			{
				pccHooks: true,
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
			{
				pccHooks: true,
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
				{
					pccHooks: true,
					...(imageCapable
						? {
								promptGuidelines: ["Pass the result to image()"],
								resultValue: codeModeImageResult,
							}
						: {}),
				},
			),
		);
	}
	if (
		ctx &&
		resolveAdapterRuntimePlanForState(ctx, runtime.state).autoReasoning
	) {
		tools.push(
			toNestedTool(
				{
					...runtime.autoReasoning.tool,
					description: "Change reasoning effort",
				},
				'tools.change_reasoning({ level: "low" | "medium" | "high" | "xhigh" | "max" })',
				{
					pccHooks: true,
					promptGuidelines: [runtime.autoReasoning.guidance()],
				},
			),
		);
	}
	return tools.filter((tool) => toolNames.has(tool.name));
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
