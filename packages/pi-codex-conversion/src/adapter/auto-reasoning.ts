import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "./activation/state.ts";
import { resolveCodexRuntimePlanForState } from "./activation/runtime-plan.ts";
import { codexReasoningLane } from "./reasoning-updates.ts";
import { auxiliaryToolRenderers, displayRecord } from "../ui/tool-rendering/auxiliary-tool.ts";

type Level = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const levels: readonly Level[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PARAMETERS = Type.Object({ level: StringEnum(["low", "medium", "high"] as const) });

interface AutoReasoning {
	begin(ctx: ExtensionContext): void;
	settle(ctx: ExtensionContext): void;
	tool: ToolDefinition<typeof PARAMETERS, { level: Level; floor: Level }>;
}

export function createAutoReasoning(pi: ExtensionAPI, state: AdapterState): AutoReasoning {
	let baseline: { level: Level; lane: string; session: string } | undefined;
	let applied: Level | undefined;
	const matches = (ctx: ExtensionContext) => baseline && ctx.model
		&& baseline.lane === codexReasoningLane(ctx.model)
		&& baseline.session === ctx.sessionManager.getSessionId();
	const begin = (ctx: ExtensionContext) => {
		if (!resolveCodexRuntimePlanForState(ctx, state).autoReasoning || !ctx.model) return;
		if (!matches(ctx)) {
			baseline = { level: pi.getThinkingLevel(), lane: codexReasoningLane(ctx.model), session: ctx.sessionManager.getSessionId() };
			applied = undefined;
		}
	};
	return {
		begin,
		settle(ctx: ExtensionContext) {
			const restore = matches(ctx) && applied !== undefined && pi.getThinkingLevel() === applied ? baseline?.level : undefined;
			baseline = undefined;
			applied = undefined;
			if (restore !== undefined) pi.setThinkingLevel(restore);
		},
		tool: {
			name: "change_reasoning",
			label: "Change Reasoning",
			description: "Adjust effort by work phase, not per tool call; user starting level is the floor, restored when the run settles",
			parameters: PARAMETERS,
			...auxiliaryToolRenderers("Reasoning adjustment failed", (_args, result) => {
				const details = displayRecord(result?.details);
				return {
					active: "Adjusting reasoning",
					complete: "Adjusted reasoning",
					...(result ? { summary: `${details["level"]} effort · user floor ${details["floor"]}`, body: "" } : {}),
				};
			}),
			async execute(_id: string, params: { level: "low" | "medium" | "high" }, _signal: AbortSignal | undefined, _update: unknown, ctx: ExtensionContext) {
				if (!resolveCodexRuntimePlanForState(ctx, state).autoReasoning) throw new Error("change_reasoning requires Auto reasoning enabled on Astra Codex transport");
				begin(ctx);
				if (!baseline) throw new Error("No Astra reasoning baseline");
				const previous = pi.getThinkingLevel();
				// A user selector change supersedes the tool's last selection.
				if (previous !== (applied ?? baseline.level)) baseline.level = previous;
				const effective = levels.indexOf(params.level) < levels.indexOf(baseline.level) ? baseline.level : params.level;
				pi.setThinkingLevel(effective);
				applied = pi.getThinkingLevel();
				const details = { level: applied, floor: baseline.level };
				return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
			},
		},
	};
}
