import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isSubagentFailure } from "./config.js";
import { ExploreParams, TOOL_LABEL, TOOL_NAME } from "./constants.js";
import { getFinalOutput, getMode } from "./messages.js";
import { renderExploreCall, renderSubagentResultBlock } from "./render.js";
import { runSubagent } from "./subagent.js";
import type {
	ChildRunDetails,
	ExploreMode,
	PersistedChildRunDetails,
} from "./types.js";

function persistedDetails(details: ChildRunDetails): PersistedChildRunDetails {
	return {
		mode: details.mode,
		cwd: details.cwd,
	};
}

export function registerExploreTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description: "Run an isolated discovery-only subagent.",
		promptSnippet: "Run an isolated discovery-only subagent.",
		promptGuidelines: [
			"explore_subagent: Net-new discovery only; don't reread already-checked files.",
			"explore_subagent: Use `shallow` for narrow, bounded scans where you only need likely hotspots, entry points, or best next reads.",
			"explore_subagent: Use `deep` for broad, open-ended, triage, compare/rank, or revisit-heavy scans.",
			"explore_subagent: No inherited context; include background, exact question, scope, constraints, cwd, and desired evidence.",
			"explore_subagent: Discovery only: inspect/summarize, no edits.",
		],
		parameters: ExploreParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const input = params as { task: string; mode: ExploreMode; cwd?: string };
			const mode = getMode(input.mode);
			if (!mode)
				throw new Error('explore_subagent requires mode: "shallow" or "deep"');
			const details = await runSubagent(
				mode,
				input.task,
				input.cwd ?? ctx.cwd,
				signal,
				onUpdate,
			);
			const finalOutput = getFinalOutput(details.messages) || "(no output)";
			if (isSubagentFailure(details)) {
				throw new Error(
					`${TOOL_LABEL} failed: ${details.errorMessage || details.stderr || finalOutput}`,
				);
			}
			return {
				content: [{ type: "text", text: finalOutput }],
				details: persistedDetails(details),
			};
		},
		renderCall(args, theme) {
			return renderExploreCall(
				args as { task: string; mode?: ExploreMode },
				theme,
			);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as
				| ChildRunDetails
				| PersistedChildRunDetails
				| undefined;
			if (!details || !("messages" in details)) {
				const first = result.content[0];
				return new Text(
					first?.type === "text" ? first.text : "(no output)",
					0,
					0,
				);
			}

			const finalOutput =
				getFinalOutput(details.messages) ||
				(result.content[0]?.type === "text"
					? result.content[0].text
					: "(no output)");
			return renderSubagentResultBlock(
				details,
				finalOutput,
				{ expanded, isPartial, showIdentity: false },
				theme,
			);
		},
	});
}
