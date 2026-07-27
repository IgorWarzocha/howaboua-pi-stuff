import type {
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { completeSummary } from "./summary-session.js";
import type { ResolvedReviewConfig } from "./types.js";

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (
				part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text"
			) {
				return String((part as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function serializeEntry(entry: SessionEntry): string | undefined {
	switch (entry.type) {
		case "message": {
			const message = entry.message as { role?: string; content?: unknown };
			const text = textFromContent(message.content).trim();
			if (!text) return undefined;
			return `## ${message.role || "message"} (${entry.timestamp})\n${text}`;
		}
		case "branch_summary":
			return `## branch summary (${entry.timestamp})\n${entry.summary}`;
		case "compaction":
			return `## compaction summary (${entry.timestamp})\n${entry.summary}`;
		case "custom_message": {
			const text = textFromContent(entry.content).trim();
			if (!text) return undefined;
			return `## custom message: ${entry.customType} (${entry.timestamp})\n${text}`;
		}
		case "model_change":
			return `## model change (${entry.timestamp})\n${entry.provider}/${entry.modelId}`;
		case "thinking_level_change":
			return `## thinking level change (${entry.timestamp})\n${entry.thinkingLevel}`;
		default:
			return undefined;
	}
}

function buildSummaryInput(entries: SessionEntry[]): string {
	return entries
		.map(serializeEntry)
		.filter((value): value is string => Boolean(value))
		.join("\n\n---\n\n");
}

function escapeConversationBlock(conversation: string): string {
	return conversation
		.replaceAll("</conversation>", "&lt;/conversation&gt;")
		.replaceAll("<conversation>", "&lt;conversation&gt;");
}

function isNoRelevantContext(summary: string): boolean {
	return (
		summary
			.trim()
			.toLowerCase()
			.replace(/^#+\s*/, "")
			.replace(/[.!]+$/, "") === "no relevant conversation context"
	);
}

function buildPrompt(conversation: string): string {
	return `You are preparing a compact branch-style summary for an isolated code-review subagent.

Summarize the current Pi session branch as durable context for reviewing the current git diff.

Rules:
- Do not quote or reproduce user/assistant turns verbatim.
- Do not include step-by-step debugging noise.
- Do not include long command output.
- Do not invent details.
- Preserve uncertainty where the conversation is ambiguous.

Capture only:
- the user's actual goal
- final or accepted implementation direction
- important constraints and non-goals
- repo areas/files that matter
- tests/checks run and their outcomes
- decisions that may make a suspicious diff intentional
- unresolved risks or TODOs relevant to review

Write concise structured markdown. If the conversation contains no useful review context, output exactly: No relevant conversation context.

<conversation>
${escapeConversationBlock(conversation)}
</conversation>`;
}

export async function buildReviewConversationSummary(
	ctx: ExtensionCommandContext,
	config: ResolvedReviewConfig,
): Promise<string | undefined> {
	if (!config.summary.enabled) return undefined;

	const conversation = buildSummaryInput(
		ctx.sessionManager.buildContextEntries(),
	);
	if (!conversation.trim()) return undefined;

	const response = await completeSummary(
		ctx,
		config,
		buildPrompt(conversation),
	);

	const summary = response.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();

	if (!summary || isNoRelevantContext(summary)) return undefined;
	return summary;
}
