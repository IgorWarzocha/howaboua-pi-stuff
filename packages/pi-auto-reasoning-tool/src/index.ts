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
	appliedLevel: AppliedReasoningLevel,
	effectiveLevel: AppliedReasoningLevel,
): string | undefined {
	if (!ctx.model) {
		return "No model selected; Pi may clamp this level later.";
	}
	if (!ctx.model.reasoning && appliedLevel === "off") {
		return `Pi clamped reasoning to off: ${ctx.model.provider}/${ctx.model.id} does not advertise reasoning support.`;
	}
	if (effectiveLevel !== appliedLevel) {
		return `Pi clamped ${effectiveLevel} to ${appliedLevel} for ${ctx.model.provider}/${ctx.model.id}.`;
	}
	return undefined;
}

function formatSelection(
	requestedLevel: ToolReasoningLevel,
	appliedLevel: AppliedReasoningLevel,
	previousLevel: AppliedReasoningLevel,
	baselineLevel: AppliedReasoningLevel,
): string[] {
	const requestedBelowBaseline =
		REASONING_LEVELS.indexOf(requestedLevel) <
		REASONING_LEVELS.indexOf(baselineLevel);
	if (requestedBelowBaseline) {
		return [
			previousLevel === appliedLevel
				? `Reasoning remains ${appliedLevel}.`
				: `Reasoning: ${previousLevel} → ${appliedLevel}.`,
			`The user set the minimum reasoning level to ${baselineLevel}; do not go below it.`,
		];
	}
	if (requestedLevel === previousLevel && previousLevel === appliedLevel) {
		return [
			previousLevel === baselineLevel
				? `Reasoning is already ${appliedLevel}, the user's preferred minimum.`
				: `Reasoning is already ${appliedLevel}.`,
		];
	}
	return [
		previousLevel === appliedLevel
			? `Reasoning remains ${appliedLevel}.`
			: `Reasoning: ${previousLevel} → ${appliedLevel}.`,
	];
}

export default function autoReasoningSelector(pi: ExtensionAPI) {
	let lastSelection: LastSelection | undefined;
	let turnBaselineReasoningLevel: AppliedReasoningLevel | undefined;
	let warnedAboutCacheImpact = false;

	pi.on("session_start", async (_event, ctx) => {
		if (warnedAboutCacheImpact) return;
		warnedAboutCacheImpact = true;
		ctx.ui.notify(
			"Auto Reasoning switches reasoning levels mid-session. This can cause prompt-cache misses and affect costs or quotas, depending on your provider. Use with caution.",
			"warning",
		);
	});

	pi.registerTool({
		name: "change_reasoning",
		label: "Change Reasoning",
		description: "Adjust reasoning effort for the work ahead.",
		promptSnippet: "Adjust reasoning effort.",
		promptGuidelines: [
			"change_reasoning: Adjust by work phase, not per tool call.",
		],
		parameters: Type.Object({
			level: StringEnum(TOOL_REASONING_LEVELS),
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

			const note = formatModelNote(ctx, appliedLevel, effectiveLevel);
			return {
				content: [
					{
						type: "text",
						text: [
							...formatSelection(
								params.level,
								appliedLevel,
								previousLevel,
								baselineLevel,
							),
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
