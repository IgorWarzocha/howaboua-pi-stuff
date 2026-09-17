import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCodeModeExtensionToolSnapshot } from "../../code-mode-extension-tools.ts";
import { renderCodexStatus } from "../../ui/status.ts";
import { ALL_CODEX_ADAPTER_TOOL_NAMES, isAdapterRuntime, resolveCodexRuntimePlanForState, type CodexRuntimePlan } from "./runtime-plan.ts";
import type { AdapterState } from "./state.ts";
import { DEFAULT_TOOL_NAMES, STATUS_KEY, buildExtraToolsOnlyStatusText } from "./tool-set.ts";

export function syncAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): CodexRuntimePlan {
	state.availableToolNames = pi.getAllTools().map((tool) => tool.name);
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	reconcileExternalToolLoadout(state, pi.getActiveTools());
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
	const changed = hasRuntimePlanChanged(state, plan);
	const previousOwned = state.adapterOwnedToolNames ?? ALL_CODEX_ADAPTER_TOOL_NAMES;
	const owned = state.enabled
		? mergeToolNames(previousOwned, plan.toolNames)
		: ALL_CODEX_ADAPTER_TOOL_NAMES;
	if (!state.enabled)
		state.previousToolNames = stripAdapterTools(pi.getActiveTools(), owned);
	state.enabled = true;
	const projectedTools = reconcileExtensionToolProjection(
		state,
		pi.getActiveTools(),
		extensionTools,
		false,
	);
	const tools = changed
		? mergeToolNames(
			restoreTools(
				state.previousToolNames ?? DEFAULT_TOOL_NAMES,
				projectedTools,
				owned,
			),
			plan.toolNames,
		)
		: projectedTools;
	state.adapterOwnedToolNames = plan.toolNames;
	applyRuntimeTools(pi, state, plan, tools);
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, !state.config.voiceFeaturesOnly && state.config.ui.statusLine ? buildExtraToolsOnlyStatusText(plan.toolNames, ctx.ui.theme) : undefined);
}

function enableAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: Extract<CodexRuntimePlan, { kind: "normal" | "code" | "notebook" }>,
	extensionTools: ExtensionToolSnapshot,
): void {
	const changed = hasRuntimePlanChanged(state, plan);
	const owned = state.enabled ? mergeToolNames(state.adapterOwnedToolNames ?? plan.ownedToolNames, plan.ownedToolNames) : plan.ownedToolNames;
	if (!state.enabled) {
		state.previousToolNames = stripAdapterTools(pi.getActiveTools(), owned);
		state.enabled = true;
	}
	const projectedTools = reconcileExtensionToolProjection(
		state,
		pi.getActiveTools(),
		extensionTools,
		plan.kind !== "normal",
	);
	let tools = projectedTools;
	if (changed) {
		const activeTools = plan.kind === "normal"
			? restoreTools(state.previousToolNames ?? [], projectedTools, owned)
			: projectedTools;
		tools = mergeAdapterTools(activeTools, plan.toolNames, owned);
	}
	state.adapterOwnedToolNames = plan.ownedToolNames;
	applyRuntimeTools(pi, state, plan, tools);
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
					false,
				)
			: pi.getActiveTools();
		const previous = state.previousToolNames ?? DEFAULT_TOOL_NAMES;
		setActiveTools(pi, restoreTools(previous, currentTools, owned));
	}
	state.enabled = false;
	delete state.adapterOwnedToolNames;
	delete state.codeModeExtensionToolNames;
	delete state.activeCodeModeExtensionToolNames;
	delete state.appliedRuntimeKind;
	delete state.appliedRuntimeToolNames;
	delete state.appliedActiveToolNames;
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY,
		plan.kind === "inactive" && plan.missingToolNames
			? `Codex adapter off: unavailable tools (${plan.missingToolNames.join(", ")}); check tool allowlist`
			: undefined);
}

function reconcileExtensionToolProjection(
	state: AdapterState,
	currentTools: string[],
	extensionTools: ExtensionToolSnapshot,
	foldIntoCodeMode: boolean,
): string[] {
	const previousTools = state.previousToolNames ?? [];
	const managedNames = new Set(extensionTools.allToolNames);
	const previousManagedNames = state.codeModeExtensionToolNames ?? [];
	const previousActiveNames = state.activeCodeModeExtensionToolNames
		?? previousManagedNames.filter((name) => previousTools.includes(name));
	const previousActiveNameSet = new Set(previousActiveNames);
	const activeNames = [
		...new Set(
			extensionTools.tools.map((tool) => tool.topLevelName ?? tool.name),
		),
	];
	const activeNameSet = new Set(activeNames);
	const releasedActiveNames = previousActiveNames.filter(
		(name) => !managedNames.has(name) && previousTools.includes(name),
	);
	state.previousToolNames = previousTools.filter(
		(name) => !managedNames.has(name) || activeNameSet.has(name),
	);
	for (const name of activeNames) {
		if (
			!state.previousToolNames.includes(name) &&
			(
				currentTools.includes(name) ||
				(!previousActiveNameSet.has(name) && previousManagedNames.includes(name))
			)
		)
			state.previousToolNames.push(name);
	}
	state.codeModeExtensionToolNames = extensionTools.allToolNames;
	state.activeCodeModeExtensionToolNames = activeNames;
	const projected = mergeToolNames(currentTools, releasedActiveNames).filter(
		(name) => !managedNames.has(name),
	);
	if (foldIntoCodeMode) return projected;
	const exposedActiveNames = state.previousToolNames.filter(
		(name) => activeNameSet.has(name),
	);
	const exposedActiveNameSet = new Set(exposedActiveNames);
	return mergeToolNames(
		currentTools.filter(
			(name) => !managedNames.has(name) || exposedActiveNameSet.has(name),
		),
		releasedActiveNames,
		exposedActiveNames,
	);
}

function reconcileExternalToolLoadout(
	state: AdapterState,
	currentTools: string[],
): void {
	if (!state.enabled || !state.appliedActiveToolNames) return;
	const current = new Set(currentTools);
	const applied = new Set(state.appliedActiveToolNames);
	const owned = new Set(state.adapterOwnedToolNames ?? []);
	state.previousToolNames = (state.previousToolNames ?? []).filter(
		(name) => !applied.has(name) || current.has(name),
	);
	for (const name of currentTools) {
		if (
			!applied.has(name) &&
			!owned.has(name) &&
			!state.previousToolNames.includes(name)
		)
			state.previousToolNames.push(name);
	}
}

function hasRuntimePlanChanged(
	state: AdapterState,
	plan: CodexRuntimePlan,
): boolean {
	return !state.enabled ||
		state.appliedRuntimeKind !== plan.kind ||
		!sameToolList(state.appliedRuntimeToolNames ?? [], plan.toolNames);
}

function applyRuntimeTools(
	pi: ExtensionAPI,
	state: AdapterState,
	plan: CodexRuntimePlan,
	toolNames: string[],
): void {
	setActiveTools(pi, toolNames);
	state.appliedRuntimeKind = plan.kind;
	state.appliedRuntimeToolNames = [...plan.toolNames];
	state.appliedActiveToolNames = [...pi.getActiveTools()];
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

function sameToolList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}
