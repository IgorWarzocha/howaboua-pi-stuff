import { obj, type Static } from "@earendil-works/pi-schema";
import { StringEnum } from "../tools/string-enum.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "./activation/state.ts";
import { resolveAdapterRuntimePlanForState } from "./activation/runtime-plan.ts";
import { codexReasoningLane } from "./reasoning-updates.ts";
import {
	auxiliaryToolRenderers,
	displayRecord,
} from "../ui/tool-rendering/auxiliary-tool.ts";

type Level = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const levels: readonly Level[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
const PARAMETERS = obj(
	{ level: StringEnum(["low", "medium", "high", "xhigh", "max"] as const) },
	{ open: true },
);
const NORMAL_GUIDANCE =
	"You should adjust reasoning effort when the work enters a new phase or turns out harder or easier than expected. Use low for routine work, medium for a quick survey, high for tracing a cause across systems, and extra high when several causes interact.";
const GPT_GUIDANCE =
	"SHOULD adapt effort when phases change or work turns out harder or easier than expected. Routine→low; quick survey→medium; cross-system cause→high; interacting causes→xhigh";

interface AutoReasoning {
	begin(ctx: ExtensionContext): void;
	settle(ctx: ExtensionContext): void;
	guidance(): string;
	tool: ToolDefinition<typeof PARAMETERS, { level: Level; floor: Level }>;
}

export function createAutoReasoning(
	pi: ExtensionAPI,
	state: AdapterState,
): AutoReasoning {
	let baseline: { level: Level; lane: string; session: string } | undefined;
	let applied: Level | undefined;
	const guidance = () =>
		state.config.prompt.heavySystemPromptOverwrite
			? GPT_GUIDANCE
			: NORMAL_GUIDANCE;
	const matches = (ctx: ExtensionContext) =>
		baseline &&
		ctx.model &&
		baseline.lane === codexReasoningLane(ctx.model) &&
		baseline.session === ctx.sessionManager.getSessionId();
	const begin = (ctx: ExtensionContext) => {
		if (
			!resolveAdapterRuntimePlanForState(ctx, state).autoReasoning ||
			!ctx.model
		)
			return;
		if (!matches(ctx)) {
			baseline = {
				level: pi.getThinkingLevel(),
				lane: codexReasoningLane(ctx.model),
				session: ctx.sessionManager.getSessionId(),
			};
			applied = undefined;
		}
	};
	return {
		begin,
		guidance,
		settle(ctx: ExtensionContext) {
			const restore =
				matches(ctx) &&
				applied !== undefined &&
				pi.getThinkingLevel() === applied
					? baseline?.level
					: undefined;
			baseline = undefined;
			applied = undefined;
			if (restore !== undefined) pi.setThinkingLevel(restore);
		},
		tool: {
			name: "change_reasoning",
			defaultActive: false,
			label: "Change Reasoning",
			description: NORMAL_GUIDANCE,
			prepareLoadout: () => ({
				descriptions: { change_reasoning: guidance() },
			}),
			parameters: PARAMETERS,
			...auxiliaryToolRenderers(
				"Reasoning adjustment failed",
				(_args, result) => {
					const details = displayRecord(result?.details);
					return {
						active: "Adjusting reasoning",
						complete: "Adjusted reasoning",
						...(result
							? {
									summary: `${details["level"]} effort · user floor ${details["floor"]}`,
									body: "",
								}
							: {}),
					};
				},
			),
			async execute(
				_id: string,
				params: Static<typeof PARAMETERS>,
				_signal: AbortSignal | undefined,
				_update: unknown,
				ctx: ExtensionContext,
			) {
				if (!resolveAdapterRuntimePlanForState(ctx, state).autoReasoning)
					throw new Error(
						"Reasoning adjustment is unavailable in this session. Continue with the current reasoning level. Other tools remain available",
					);
				begin(ctx);
				if (!baseline)
					throw new Error(
						"Reasoning adjustment is unavailable in this session. Continue with the current reasoning level. Other tools remain available",
					);
				const previous = pi.getThinkingLevel();
				// A user selector change supersedes the tool's last selection.
				if (previous !== (applied ?? baseline.level)) baseline.level = previous;
				const effective =
					levels.indexOf(params.level) < levels.indexOf(baseline.level)
						? baseline.level
						: params.level;
				pi.setThinkingLevel(effective);
				applied = pi.getThinkingLevel();
				const details = { level: applied, floor: baseline.level };
				return {
					content: [
						{
							type: "text" as const,
							text: `${JSON.stringify(details)}\nResets to ${baseline.level} when the turn ends.`,
						},
					],
					details,
				};
			},
		},
	};
}
