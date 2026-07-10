import { StringEnum, Type } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ToolReasoningLevel = "low" | "medium" | "high";
type AppliedReasoningLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

type LastSelection = {
	requestedLevel: ToolReasoningLevel;
	appliedLevel: AppliedReasoningLevel;
	previousLevel: AppliedReasoningLevel;
	baselineLevel: AppliedReasoningLevel;
};

const TOOL_REASONING_LEVELS = ["low", "medium", "high"] as const;
const REASONING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly AppliedReasoningLevel[];
export function applyReasoningFloor(
	requestedLevel: ToolReasoningLevel,
	baselineLevel: AppliedReasoningLevel,
): AppliedReasoningLevel {
	return REASONING_LEVELS.indexOf(requestedLevel) <
		REASONING_LEVELS.indexOf(baselineLevel)
		? baselineLevel
		: requestedLevel;
}

function formatModelNote(
	ctx: ExtensionContext,
	requestedLevel: ToolReasoningLevel,
	appliedLevel: AppliedReasoningLevel,
	effectiveLevel: AppliedReasoningLevel,
	baselineLevel: AppliedReasoningLevel,
): string | undefined {
	const notes: string[] = [];
	if (effectiveLevel !== requestedLevel)
		notes.push(
			`Kept the user-selected ${baselineLevel} baseline instead of lowering it to ${requestedLevel}.`,
		);
	if (!ctx.model) {
		notes.push(
			"No model is selected yet; Pi may clamp this level after a model is selected.",
		);
		return notes.join("\n");
	}
	if (!ctx.model.reasoning && appliedLevel === "off") {
		notes.push(
			`Current model ${ctx.model.provider}/${ctx.model.id} does not advertise reasoning support, so Pi clamped the level to off.`,
		);
		return notes.join("\n");
	}
	if (effectiveLevel !== appliedLevel) {
		notes.push(
			`Pi clamped ${effectiveLevel} to ${appliedLevel} for ${ctx.model.provider}/${ctx.model.id}.`,
		);
	}
	return notes.length > 0 ? notes.join("\n") : undefined;
}

export default function autoReasoningSelector(pi: ExtensionAPI) {
	let lastSelection: LastSelection | undefined;
	let turnBaselineReasoningLevel: AppliedReasoningLevel | undefined;

	pi.registerTool({
		name: "change_reasoning",
		label: "Change Reasoning",
		description:
			"Temporarily adjust reasoning up to high without lowering below the user's turn baseline.",
		promptSnippet: "Adjust reasoning effort within the user's safe baseline.",
		promptGuidelines: [
			"change_reasoning: Treat the user's current turn level as the baseline; call only to increase effort for harder work or return after an earlier increase.",
			"change_reasoning: Autonomous choices are low, medium, and high; the extension never lowers below the user baseline or selects xhigh/max.",
			"change_reasoning: Use sparingly; avoid standalone calls when another useful tool call can run in parallel.",
			"change_reasoning: Use medium for complex single tasks, feature planning, or multi-step implementation.",
			"change_reasoning: Use high for multi-area architecture work, hard debugging, or unexpectedly difficult tasks.",
		],
		parameters: Type.Object({
			level: StringEnum(TOOL_REASONING_LEVELS, {
				description: "low | medium | high",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const baselineLevel = turnBaselineReasoningLevel ?? pi.getThinkingLevel();
			const previousLevel = pi.getThinkingLevel();
			const effectiveLevel = applyReasoningFloor(params.level, baselineLevel);
			pi.setThinkingLevel(effectiveLevel);
			const appliedLevel = pi.getThinkingLevel();

			lastSelection = {
				requestedLevel: params.level,
				appliedLevel,
				previousLevel,
				baselineLevel,
			};

			const note = formatModelNote(
				ctx,
				params.level,
				appliedLevel,
				effectiveLevel,
				baselineLevel,
			);
			return {
				content: [
					{
						type: "text",
						text: [
							`Reasoning level: ${previousLevel} → ${appliedLevel}${params.level !== appliedLevel ? ` (requested ${params.level})` : ""}.`,
							`Turn baseline: ${baselineLevel}.`,
							"The new level applies to subsequent model calls.",
							note,
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				details: lastSelection,
			};
		},
	});

	pi.on("before_agent_start", async () => {
		turnBaselineReasoningLevel ??= pi.getThinkingLevel();
	});

	pi.on("agent_start", async () => {
		turnBaselineReasoningLevel ??= pi.getThinkingLevel();
	});

	pi.on("agent_settled", async () => {
		const levelToRestore = turnBaselineReasoningLevel ?? pi.getThinkingLevel();
		turnBaselineReasoningLevel = undefined;
		pi.setThinkingLevel(levelToRestore);
	});
}
