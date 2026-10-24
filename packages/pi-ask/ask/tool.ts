import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Check } from "typebox/value";
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
	isGpt?(): boolean;
}

export function createAskRuntime({
	askInComposer,
	deliverSteer,
	onBlockedChange,
	onPendingChange,
	onRequestChange,
	isGpt = () => false,
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
			if (!Check(AskParameters, params))
				throw new Error("Invalid ask arguments; ask({}) returns help");
			return params;
		},
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			if (isAskHelpInput(params)) {
				return {
					content: [
						textContent(
							(isGpt()
								? [
										'ask({prompts:[{title,body?,multiple?,choices?:[{label,description?}]}],delivery?:"wait"|"steer",handoff?})',
										"wait default; steer only with reversible work remaining. Handoff: await user action; state completion signal",
										"Review: each finding=prompt+disposition choices; never report first",
										"Other/rephrase automatic; no choices=free text; blank Other/rephrase=rephrase/follow up",
									]
								: [
										'ask({ prompts: [{ title, body?, multiple?, choices?: [{ label, description? }] }], delivery?: "wait"|"steer", handoff? })',
										"Omit delivery to wait; steer only while reversible work can continue. Handoffs wait for user action; state the completion signal",
										"For reviews, make each finding a prompt with disposition choices; do not report first",
										"Other/rephrase is automatic; omit choices for free text. Blank Other/rephrase means rephrase or follow up",
									]
							).join("\n"),
						),
					],
					details: { kind: "help" },
				};
			}
			const { delivery, handoff, prompts } = normalizeAskInput(params);
			if (prompts.length === 0) {
				throw new Error(
					"ask requires at least one prompt with a non-empty title.",
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
							"Question queued. Continue working; the response will arrive as steering.",
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
			const count = Array.isArray(args.prompts) ? args.prompts.length : 0;
			const label =
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
