import { defineTool } from "@earendil-works/pi-coding-agent";
import { compile, type Static } from "@earendil-works/pi-schema";
import { Text } from "@earendil-works/pi-tui";
import { AskParameters, type AskPrompt } from "./contracts.js";
import {
	type AskCoordinatorOptions,
	createAskCoordinator,
} from "./coordinator.js";
import {
	askInputProblem,
	isAskHelpInput,
	isSteeringAskInput,
	normalizeAskInput,
	normalizeResponses,
	summarizeResponses,
	textContent,
} from "./normalize.js";

const askValidator = compile(AskParameters);

interface BlockedState {
	id: string;
	active: boolean;
	label: string;
	prompt: string;
	handoff: boolean;
	prompts: AskPrompt[];
}

type OnBlockedChange = (state: BlockedState) => void;

interface AskToolOptions extends AskCoordinatorOptions {
	onBlockedChange?: OnBlockedChange;
}

export function createAskRuntime({
	askInComposer,
	deliverSteer,
	onBlockedChange,
	onPendingChange,
	onRequestChange,
}: AskToolOptions = {}) {
	const coordinator = createAskCoordinator({
		...(askInComposer ? { askInComposer } : {}),
		...(deliverSteer ? { deliverSteer } : {}),
		...(onPendingChange ? { onPendingChange } : {}),
		...(onRequestChange ? { onRequestChange } : {}),
	});

	const tool = defineTool({
		name: "ask",
		label: "Ask",
		description: "Request user input or action",
		parameters: AskParameters,
		executionMode: "sequential",
		prepareArguments(input) {
			const params = input === undefined ? {} : input;
			const problem = askInputProblem(params);
			if (problem) throw new Error(problem);
			if (!askValidator.check(params))
				throw new Error("Invalid arguments. Help: ask({}).");
			return params;
		},
		async execute(
			toolCallId,
			params: Static<typeof AskParameters>,
			signal,
			_onUpdate,
			ctx,
		) {
			if (isAskHelpInput(params)) {
				return {
					content: [
						textContent(
							[
								'ask({prompts:[{title,body?,multiple?,choices?:[{label,description?}]}],delivery?:"wait"|"steer",handoff?:boolean})',
								"wait default; steer only while reversible work can continue. Handoff requires wait; state action+completion signal",
								"Each review finding MUST go directly into a prompt with disposition choices",
								"Auto Other/rephrase; no choices=free text; blank Other/rephrase→rephrase/follow up",
							].join("\n"),
						),
					],
					details: { kind: "help" },
				};
			}
			const { delivery, handoff, prompts } = normalizeAskInput(params);
			if (prompts.length === 0) {
				throw new Error(
					"At least one prompt needs a non-empty title. Help: ask({}).",
				);
			}
			if (!askInComposer && !ctx.hasUI)
				throw new Error("ask requires an interactive UI.");
			if (handoff && delivery === "steer")
				throw new Error("ask handoffs require delivery wait.");
			if (delivery === "steer") {
				if (!coordinator.canSteer)
					throw new Error("ask steering delivery is unavailable.");
				signal?.throwIfAborted();
				coordinator.requestSteer({ id: toolCallId, prompts }, ctx);
				return {
					content: [
						textContent(
							"Question queued. Continue working. Reply arrives as steering.",
						),
					],
					details: { kind: "prompt", pending: true, id: toolCallId },
				};
			}

			const blockedState = {
				id: toolCallId,
				active: true,
				handoff,
				prompts,
				label: handoff ? "Human action needed" : "Waiting for input",
				prompt: handoff
					? "The user needs to complete an action before the active work can continue. Please announce this briefly in your natural voice."
					: "User input is required before the active work can continue. Please announce this briefly in your natural voice.",
			};
			const presentationSignal = signal
				? AbortSignal.any([signal, coordinator.sessionSignal])
				: coordinator.sessionSignal;
			let rawResponses: unknown;
			try {
				rawResponses = await coordinator.present(ctx, prompts, {
					id: toolCallId,
					handoff,
					signal: presentationSignal,
					onActiveChange: (active) =>
						onBlockedChange?.({ ...blockedState, active }),
				});
				coordinator.complete(toolCallId);
			} catch (error) {
				coordinator.complete(toolCallId, String(error));
				throw error;
			}
			const responses = normalizeResponses(prompts, rawResponses);
			if (!responses) {
				return {
					content: [
						textContent(
							handoff ? "Handoff dismissed by user." : "Dismissed by user.",
						),
					],
					details: { dismissed: true, kind: handoff ? "handoff" : "prompt" },
				};
			}
			return {
				content: [textContent(summarizeResponses(prompts, responses))],
				details: { kind: handoff ? "handoff" : "prompt", responses },
			};
		},
		renderCall(args, theme, context) {
			if (isAskHelpInput(args))
				return new Text(theme.fg("toolTitle", theme.bold("ask help")), 0, 0);
			const prompts =
				args && typeof args === "object" && "prompts" in args
					? args.prompts
					: undefined;
			const count = Array.isArray(prompts) ? prompts.length : 0;
			const label =
				args &&
				typeof args === "object" &&
				"handoff" in args &&
				args.handoff === true
					? "ask handoff "
					: isSteeringAskInput(args)
						? "ask steer "
						: "ask ";
			return new Text(
				theme.fg(
					context && "isBlocked" in context && context.isBlocked === true
						? "warning"
						: "toolTitle",
					theme.bold(label),
				) + theme.fg("muted", `${count} prompt${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const text =
				result.content[0]?.type === "text" ? result.content[0].text : "";
			return new Text(theme.fg("success", text), 0, 0);
		},
	});

	return {
		tool,
		reply: coordinator.reply,
		restorePending: coordinator.restorePending,
		shutdown: coordinator.shutdown,
	};
}

export function createAskTool(options: AskToolOptions = {}) {
	return createAskRuntime(options).tool;
}
