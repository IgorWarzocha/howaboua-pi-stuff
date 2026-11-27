import { getCurrentTools } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { EXEC_TOOL_NAMES, NESTED_ADAPTER_TOOL_NAMES } from "./tool-set.ts";

const NATIVE_NESTED_SELECTION_ENTRY =
	"pi-codex-conversion-native-nested-selection";

type Branch = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

function recordsNativeNestedSelection(branch: Branch): boolean {
	return branch.some(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === NATIVE_NESTED_SELECTION_ENTRY,
	);
}

/** Before native dispatch, PCC left its nested tool names out of Pi's saved loadout. */
export function isLegacyCodeSelection(ctx: ExtensionContext): boolean {
	const branch = ctx.sessionManager.getBranch();
	if (recordsNativeNestedSelection(branch)) return false;
	const recordedNames = getCurrentTools(
		branch.flatMap((entry) =>
			entry.type === "message" ? [entry.message] : [],
		),
	).map(({ name }) => name);
	return (
		EXEC_TOOL_NAMES.every((name) => recordedNames.includes(name)) &&
		!NESTED_ADAPTER_TOOL_NAMES.some((name) => recordedNames.includes(name))
	);
}

/** Mark the branch format, not the names. Pi remains the selection owner. */
export function recordNativeNestedSelection(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): void {
	if (!recordsNativeNestedSelection(ctx.sessionManager.getBranch()))
		pi.appendEntry(NATIVE_NESTED_SELECTION_ENTRY);
}
