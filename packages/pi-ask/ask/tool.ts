import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AskParameters } from "./contracts.js";
import {
	type AskCoordinatorOptions,
	createAskCoordinator,
} from "./coordinator.js";
import {
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
}: AskToolOptions = {}) {
	const coordinator = createAskCoordinator({
		...(askInComposer ? { askInComposer } : {}),
		...(deliverSteer ? { deliverSteer } : {}),
		...(onPendingChange ? { onPendingChange } : {}),
	});

	const tool = defineTool({
		name: "ask",
		label: "Ask",
		description: "Request user input or action. Requires interactive UI.",
		parameters: AskParameters,
		promptSnippet: "Request human input or action.",
		promptGuidelines: [
			"ask: Use steer only while useful reversible work can continue; wait for gating answers and handoffs, stating a handoff's completion signal.",
			"ask: For reviews, make each finding a prompt with disposition choices; do not report first.",
			"ask: Do not add Other/rephrase; it is automatic.",
		],
		executionMode: "sequential",
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
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
							"Question presented. Continue working; the response will arrive as user steering.",
						),
					],
					details: { kind: "prompt", pending: true, id: toolCallId },
				};
			}

			const blockedState = {
				id: toolCallId,
				active: true,
				label: handoff ? "Human action needed" : "Waiting for input",
				prompt: handoff
					? "The user needs to complete an action before the active work can continue. Please announce this briefly in your natural voice."
					: "User input is required before the active work can continue. Please announce this briefly in your natural voice.",
			};
			onBlockedChange?.(blockedState);
			let rawResponses: unknown;
			try {
				const presentationSignal = signal
					? AbortSignal.any([signal, coordinator.sessionSignal])
					: coordinator.sessionSignal;
				rawResponses = await coordinator.present(ctx, prompts, {
					handoff,
					signal: presentationSignal,
				});
			} finally {
				onBlockedChange?.({ ...blockedState, active: false });
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
		restorePending: coordinator.restorePending,
		shutdown: coordinator.shutdown,
	};
}

export function createAskTool(options: AskToolOptions = {}) {
	return createAskRuntime(options).tool;
}
