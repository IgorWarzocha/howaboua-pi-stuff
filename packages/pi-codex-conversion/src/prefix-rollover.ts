import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
	CustomMessageEntryDraft,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const PREFIX_ROLLOVER_CHANNEL = "pi-codex-conversion:prefix-rollover:v2";
const PREFIX_CONTEXT_BRANCH_CHANNEL =
	"pi-codex-conversion:prefix-context-branch:v2";

export type PrefixRetainedGuidance =
	| { kind: "virtual"; entryId: string }
	| {
			kind: "foreign";
			entryId: string;
			message: Extract<AgentMessage, { role: "custom" }>;
	  };

export interface PrefixRolloverPlan {
	kickoff: Extract<AgentMessage, { role: "user" | "custom" }>;
	carrier: Extract<AgentMessage, { role: "custom" }>;
	recovery: CustomMessageEntryDraft & { content: string };
	retainedGuidance: readonly PrefixRetainedGuidance[];
	arm(): boolean;
}

export interface PrefixRolloverRequest {
	protocol: 2;
	ctx: ExtensionContext;
	virtualEntryIds?: readonly string[];
	plan?: PrefixRolloverPlan;
}

/** Ask an optional context owner to plan a safe prefix-change rollover. */
export function requestPrefixRollover(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	virtualEntryIds: readonly string[],
): PrefixRolloverPlan | undefined {
	const request: PrefixRolloverRequest = { protocol: 2, ctx, virtualEntryIds };
	pi.events.emit(PREFIX_ROLLOVER_CHANNEL, request);
	return request.plan;
}

/** Ask the optional window owner for its logical branch, if a reference cut is active. */
export function prefixContextBranch(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): readonly SessionEntry[] | undefined {
	const request: {
		protocol: 2;
		ctx: ExtensionContext;
		entries?: readonly SessionEntry[];
	} = { protocol: 2, ctx };
	pi.events.emit(PREFIX_CONTEXT_BRANCH_CHANNEL, request);
	return request.entries;
}
