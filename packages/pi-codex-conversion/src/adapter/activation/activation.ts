import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCodeModeExtensionToolSnapshot } from "../../code-mode-extension-tools.ts";
import { renderCodexStatus } from "../../ui/status.ts";
import {
	ALL_CODEX_ADAPTER_TOOL_NAMES,
	isAdapterRuntime,
	resolveAdapterRuntimePlanForState,
	type AdapterRuntimePlan,
	type ActiveRuntimePlan,
} from "./runtime-plan.ts";
import type { AdapterState } from "./state.ts";
import { isLegacyCodeSelection } from "./native-nested-selection.ts";
import {
	EXEC_TOOL_NAMES,
	NESTED_ADAPTER_TOOL_NAMES,
	REPLACED_PI_TOOL_NAMES,
	STATUS_KEY,
} from "./tool-set.ts";

export function syncAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
): AdapterRuntimePlan {
	state.availableToolNames = pi.getAllTools().map((tool) => tool.name);
	const plan = resolveAdapterRuntimePlanForState(ctx, state);
	reconcileExternalToolLoadout(state, pi.getActiveTools());
	const extensionTools =
		state.enabled || isAdapterRuntime(plan)
			? getCodeModeExtensionToolSnapshot(pi, ctx, { refreshGates: true })
			: { tools: [], allToolNames: [] };
	if (isAdapterRuntime(plan))
		enableAdapter(pi, ctx, state, plan, extensionTools);
	else disableAdapter(pi, ctx, state, plan, extensionTools);
	return plan;
}

type ExtensionToolSnapshot = ReturnType<
	typeof getCodeModeExtensionToolSnapshot
>;

function enableAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: ActiveRuntimePlan,
	extensionTools: ExtensionToolSnapshot,
): void {
	const changed = hasRuntimePlanChanged(state, plan);
	const restoredNestedToolNames = state.suspendedNestedToolNames;
	delete state.suspendedNestedToolNames;
	const owned = state.enabled
		? mergeToolNames(
				state.adapterOwnedToolNames ?? plan.ownedToolNames,
				plan.ownedToolNames,
			)
		: plan.ownedToolNames;
	if (!state.enabled) {
		state.previousToolNames = stripAdapterTools(pi.getActiveTools(), owned);
		state.enabled = true;
	}
	const projectedTools = reconcileExtensionToolProjection(
		state,
		pi.getActiveTools(),
		extensionTools,
	);
	let tools = projectedTools;
	if (changed) {
		// A restored Code selection carries its own optional tools, even before
		// this instance has applied any loadout.
		const hadExecLoadout = [
			state.appliedRuntimeToolNames ?? [],
			projectedTools,
		].some((selection) =>
			EXEC_TOOL_NAMES.every((name) => selection.includes(name)),
		);
		const migrateLegacySelection =
			!state.appliedRuntimeKind &&
			EXEC_TOOL_NAMES.every((name) => projectedTools.includes(name)) &&
			!plan.nestedToolNames.some((name) => projectedTools.includes(name)) &&
			isLegacyCodeSelection(ctx);
		// Pi persists the admitted selection. Hide replaced declarations at request time.
		tools = mergeToolNames(
			plan.toolNames,
			plan.nestedToolNames.filter(
				(name) =>
					state.availableToolNames?.includes(name) &&
					(migrateLegacySelection ||
						(hadExecLoadout
							? projectedTools.includes(name)
							: !restoredNestedToolNames ||
								restoredNestedToolNames.includes(name))),
			),
			stripAdapterTools(projectedTools, owned),
		);
	}
	state.adapterOwnedToolNames = plan.ownedToolNames;
	state.appliedRuntimeKind = plan.kind;
	// The prepareLoadout hook needs the new runtime kind even if Pi already selected these names.
	if (changed) pi.setActiveTools(tools);
	else setActiveTools(pi, tools);
	state.appliedRuntimeToolNames = [...plan.toolNames];
	state.appliedActiveToolNames = [...pi.getActiveTools()];
	renderCodexStatus(ctx, state, plan);
}

function disableAdapter(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: AdapterState,
	plan: AdapterRuntimePlan,
	extensionTools: ExtensionToolSnapshot,
): void {
	const owned = state.adapterOwnedToolNames ?? plan.ownedToolNames;
	if (
		state.enabled ||
		(!(plan.kind === "inactive" && plan.missingToolNames) &&
			pi.getActiveTools().some((name) => owned.includes(name)))
	) {
		const activeTools = pi.getActiveTools();
		if (
			state.appliedRuntimeKind ||
			EXEC_TOOL_NAMES.every((name) => activeTools.includes(name))
		)
			state.suspendedNestedToolNames = activeTools.filter((name) =>
				NESTED_ADAPTER_TOOL_NAMES.includes(name),
			);
		const currentTools = state.enabled
			? reconcileExtensionToolProjection(state, activeTools, extensionTools)
			: activeTools;
		// Registration cleanup has no prior loadout to restore, even after an earlier activation.
		const previous = state.enabled ? (state.previousToolNames ?? []) : [];
		setActiveTools(pi, restoreTools(previous, currentTools, owned));
	}
	state.enabled = false;
	delete state.adapterOwnedToolNames;
	delete state.codeModeExtensionToolNames;
	delete state.activeCodeModeExtensionToolNames;
	delete state.appliedRuntimeKind;
	delete state.appliedRuntimeToolNames;
	delete state.appliedActiveToolNames;
	delete state.hiddenCodeModeToolNames;
	if (ctx.hasUI)
		ctx.ui.setStatus(
			STATUS_KEY,
			plan.kind === "inactive" && plan.missingToolNames
				? `Codex adapter off: unavailable tools (${plan.missingToolNames.join(", ")}); check tool allowlist`
				: undefined,
		);
}

function reconcileExtensionToolProjection(
	state: AdapterState,
	currentTools: string[],
	extensionTools: ExtensionToolSnapshot,
): string[] {
	const previousTools = state.previousToolNames ?? [];
	const managedNames = new Set(extensionTools.allToolNames);
	const previousManagedNames = state.codeModeExtensionToolNames ?? [];
	const previousActiveNames =
		state.activeCodeModeExtensionToolNames ??
		previousManagedNames.filter((name) => previousTools.includes(name));
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
			(currentTools.includes(name) ||
				(!previousActiveNameSet.has(name) &&
					previousManagedNames.includes(name)))
		)
			state.previousToolNames.push(name);
	}
	state.codeModeExtensionToolNames = extensionTools.allToolNames;
	state.activeCodeModeExtensionToolNames = activeNames;
	// Keep nested integrations active so Pi records their admission for resume/tree.
	// The Code Mode loadout bridge hides their provider-facing declarations instead.
	const exposedActiveNames = state.previousToolNames.filter((name) =>
		activeNameSet.has(name),
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
	plan: AdapterRuntimePlan,
): boolean {
	return (
		!state.enabled ||
		state.appliedRuntimeKind !== plan.kind ||
		!sameToolList(state.appliedRuntimeToolNames ?? [], plan.toolNames)
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

export function mergeAdapterTools(
	activeTools: string[],
	adapterTools: string[],
	adapterOwnedTools: string[] = adapterTools,
): string[] {
	const owned = new Set([...adapterTools, ...adapterOwnedTools]);
	const preserved = activeTools.filter(
		(name) => !REPLACED_PI_TOOL_NAMES.includes(name) && !owned.has(name),
	);
	return [...adapterTools, ...preserved];
}

export function restoreTools(
	previousTools: string[],
	activeTools: string[],
	adapterOwnedTools: string[] = ALL_CODEX_ADAPTER_TOOL_NAMES,
): string[] {
	const restored = stripAdapterTools(previousTools, adapterOwnedTools);
	for (const name of activeTools)
		if (!adapterOwnedTools.includes(name) && !restored.includes(name))
			restored.push(name);
	return restored;
}

export function stripAdapterTools(
	toolNames: string[],
	adapterOwnedTools: string[] = ALL_CODEX_ADAPTER_TOOL_NAMES,
): string[] {
	return toolNames.filter((name) => !adapterOwnedTools.includes(name));
}

function sameToolList(left: string[], right: string[]): boolean {
	return (
		left.length === right.length &&
		left.every((name, index) => name === right[index])
	);
}
