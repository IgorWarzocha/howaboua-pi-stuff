import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCodeModeExtensionToolSnapshot } from "../../code-mode-extension-tools.ts";
import { renderCodexStatus } from "../../ui/status.ts";
import { ALL_CODEX_ADAPTER_TOOL_NAMES, isAdapterRuntime, resolveCodexRuntimePlanForState, type CodexRuntimePlan } from "./runtime-plan.ts";
import type { AdapterState } from "./state.ts";
import { DEFAULT_TOOL_NAMES, STATUS_KEY, buildExtraToolsOnlyStatusText } from "./tool-set.ts";

export function syncAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): CodexRuntimePlan {
	state.availableToolNames = pi.getAllTools().map((tool) => tool.name);
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	const extensionTools =
		state.enabled || plan.kind === "extras" || isAdapterRuntime(plan)
			? getCodeModeExtensionToolSnapshot(pi, ctx, true)
			: { tools: [], allToolNames: [] };
	if (plan.kind === "extras")
		enableExtraTools(pi, ctx, state, plan, extensionTools);
	else if (isAdapterRuntime(plan))
		enableAdapter(pi, ctx, state, plan, extensionTools);
	else disableAdapter(pi, ctx, state, plan, extensionTools);
	return plan;
}

type ExtensionToolSnapshot = ReturnType<typeof getCodeModeExtensionToolSnapshot>;

function enableExtraTools(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: CodexRuntimePlan,
	extensionTools: ExtensionToolSnapshot,
): void {
	if (!state.enabled || !sameToolSet(state.adapterOwnedToolNames ?? [], plan.toolNames)) {
		state.previousToolNames = state.enabled
			? restoreTools(state.previousToolNames?.length ? state.previousToolNames : DEFAULT_TOOL_NAMES, pi.getActiveTools(), state.adapterOwnedToolNames ?? ALL_CODEX_ADAPTER_TOOL_NAMES)
			: stripAdapterTools(pi.getActiveTools(), ALL_CODEX_ADAPTER_TOOL_NAMES);
		state.enabled = true;
	}
	reconcileExtensionToolProjection(state, pi.getActiveTools(), extensionTools);
	state.adapterOwnedToolNames = plan.toolNames;
	setActiveTools(
		pi,
		mergeToolNames(state.previousToolNames ?? DEFAULT_TOOL_NAMES, plan.toolNames),
	);
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, !state.config.voiceFeaturesOnly && state.config.ui.statusLine ? buildExtraToolsOnlyStatusText(plan.toolNames, ctx.ui.theme) : undefined);
}

function enableAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: Extract<CodexRuntimePlan, { kind: "normal" | "code" | "notebook" }>,
	extensionTools: ExtensionToolSnapshot,
): void {
	const owned = state.enabled ? mergeToolNames(state.adapterOwnedToolNames ?? plan.ownedToolNames, plan.ownedToolNames) : plan.ownedToolNames;
	if (!state.enabled) {
		state.previousToolNames = stripAdapterTools(pi.getActiveTools(), owned);
		state.enabled = true;
	}
	const projectedTools = reconcileExtensionToolProjection(
		state,
		pi.getActiveTools(),
		extensionTools,
	);
	const activeTools = plan.kind === "normal"
		? restoreTools(state.previousToolNames ?? [], projectedTools, owned)
		: projectedTools;
	const tools = mergeAdapterTools(activeTools, plan.toolNames, owned);
	state.adapterOwnedToolNames = plan.ownedToolNames;
	setActiveTools(pi, tools);
	renderCodexStatus(ctx, state, plan);
}

function disableAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: CodexRuntimePlan,
	extensionTools: ExtensionToolSnapshot,
): void {
	const owned = state.adapterOwnedToolNames ?? plan.ownedToolNames;
	if (state.enabled || (!(plan.kind === "inactive" && plan.missingToolNames) && pi.getActiveTools().some((name) => owned.includes(name)))) {
		const currentTools = state.enabled
			? reconcileExtensionToolProjection(
					state,
					pi.getActiveTools(),
					extensionTools,
				)
			: pi.getActiveTools();
		const previous = state.previousToolNames?.length
			? state.previousToolNames
			: DEFAULT_TOOL_NAMES;
		setActiveTools(pi, restoreTools(previous, currentTools, owned));
	}
	state.enabled = false;
	delete state.adapterOwnedToolNames;
	delete state.codeModeExtensionToolNames;
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY,
		plan.kind === "inactive" && plan.missingToolNames
			? `Codex adapter off: unavailable tools (${plan.missingToolNames.join(", ")}); check tool allowlist`
			: undefined);
}

function reconcileExtensionToolProjection(
	state: AdapterState,
	currentTools: string[],
	extensionTools: ExtensionToolSnapshot,
): string[] {
	const previousTools = state.previousToolNames ?? [];
	const managedNames = new Set(extensionTools.allToolNames);
	const previousManagedNames = state.codeModeExtensionToolNames ?? [];
	const releasedActiveNames = previousManagedNames.filter(
		(name) => !managedNames.has(name) && previousTools.includes(name),
	);
	const activeNames = new Set(
		extensionTools.tools.map((tool) => tool.topLevelName ?? tool.name),
	);
	state.previousToolNames = previousTools.filter(
		(name) => !managedNames.has(name) || activeNames.has(name),
	);
	for (const name of activeNames) {
		if (!state.previousToolNames.includes(name))
			state.previousToolNames.push(name);
	}
	state.codeModeExtensionToolNames = extensionTools.allToolNames;
	return mergeToolNames(currentTools, releasedActiveNames).filter(
		(name) => !managedNames.has(name),
	);
}

function mergeToolNames(...groups: string[][]): string[] {
	return [...new Set(groups.flat())];
}

function setActiveTools(pi: ExtensionAPI, toolNames: string[]): void {
	const current = pi.getActiveTools();
	if (
		current.length !== toolNames.length ||
		current.some((name, index) => name !== toolNames[index])
	)
		pi.setActiveTools(toolNames);
}

export function mergeAdapterTools(activeTools: string[], adapterTools: string[], adapterOwnedTools: string[] = adapterTools): string[] {
	const owned = new Set([...adapterTools, ...adapterOwnedTools]);
	const preserved = activeTools.filter((name) => !DEFAULT_TOOL_NAMES.includes(name) && !owned.has(name));
	return [...adapterTools, ...preserved];
}

export function restoreTools(previousTools: string[], activeTools: string[], adapterOwnedTools: string[] = ALL_CODEX_ADAPTER_TOOL_NAMES): string[] {
	const restored = stripAdapterTools(previousTools, adapterOwnedTools);
	for (const name of activeTools) if (!adapterOwnedTools.includes(name) && !restored.includes(name)) restored.push(name);
	return restored;
}

export function stripAdapterTools(toolNames: string[], adapterOwnedTools: string[] = ALL_CODEX_ADAPTER_TOOL_NAMES): string[] {
	return toolNames.filter((name) => !adapterOwnedTools.includes(name));
}

function sameToolSet(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name) => right.includes(name));
}
