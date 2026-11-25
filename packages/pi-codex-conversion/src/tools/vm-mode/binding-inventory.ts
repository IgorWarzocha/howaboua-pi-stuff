import { VM_RESET_EXEC } from "../code-mode/exec-contract.ts";

export type VmBindingInventory =
	| { kind: "bindings"; names: string[]; warn: boolean }
	| { kind: "reset"; storedKeysSummary: string };

export function formatVmBindingInventory(
	status: VmBindingInventory,
	heavySystemPromptOverwrite: boolean,
): string {
	if (status.kind === "reset")
		return `VM reset automatically at critical memory pressure. All bindings cleared. ${status.storedKeysSummary}`;
	const { names, warn } = status;
	const shown: string[] = [];
	let length = 0;
	for (const name of names) {
		if (length + name.length + 2 > 8_000) continue;
		shown.push(name);
		length += name.length + 2;
	}
	const omitted = names.length - shown.length;
	const inventory = `VM bindings: ${shown.length ? shown.join(", ") : omitted ? "none shown" : "none"}${omitted ? ` (${omitted} omitted)` : ""}`;
	if (!warn) return inventory;
	const warning = heavySystemPromptOverwrite
		? `VM memory high. Release large values or save needed JSON with store("key", value). To clear all bindings, send ${VM_RESET_EXEC} as the whole exec call. Stored values survive: load("key").`
		: `VM memory is running low. Release large values you no longer need. If you need a fresh VM, save any small JSON values you still need with store("key", value), then send ${VM_RESET_EXEC} as the entire next exec call. This clears all variables and functions. Stored values survive; recover them with load("key").`;
	return `${inventory}\n${warning}`;
}
