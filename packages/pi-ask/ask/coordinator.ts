import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskPrompt, PendingAsk } from "./contracts.js";
import { normalizeResponses, summarizeResponses } from "./normalize.js";
import type { PendingAskUpdate } from "./pending.js";
import { askWithPiUi } from "./pi-ui.js";
import { askInTui } from "./tui.js";

type AskInComposer = (
	prompts: AskPrompt[],
	signal: AbortSignal | undefined,
) => Promise<unknown>;

export interface AskCoordinatorOptions {
	askInComposer?: AskInComposer;
	deliverSteer?: (message: string) => void;
	onPendingChange?: (update: PendingAskUpdate) => void;
}

interface PresentAskOptions {
	handoff?: boolean;
	steering?: boolean;
	signal?: AbortSignal;
}

function steerResponse(prompts: AskPrompt[], responses: unknown): string {
	const normalized = normalizeResponses(prompts, responses);
	return normalized
		? `Response to your earlier ask:\n${summarizeResponses(prompts, normalized)}`
		: `I dismissed your earlier ask: ${prompts.map((prompt) => prompt.title).join("; ")}`;
}

export function createAskCoordinator({
	askInComposer,
	deliverSteer,
	onPendingChange,
}: AskCoordinatorOptions = {}) {
	let generation = 0;
	let sessionAbort = new AbortController();
	let presentationTail = Promise.resolve();
	const activeSteers = new Set<string>();

	const present = (
		ctx: ExtensionContext,
		prompts: AskPrompt[],
		{ handoff = false, steering = false, signal }: PresentAskOptions = {},
	): Promise<unknown> => {
		const run = async () => {
			if (signal?.aborted) return null;
			return askInComposer
				? await askInComposer(prompts, signal)
				: ctx.mode === "tui"
					? await askInTui(ctx, prompts, {
							handoff,
							steering,
							...(signal ? { signal } : {}),
						})
					: await askWithPiUi(ctx, prompts, {
							handoff,
							steering,
							...(signal ? { signal } : {}),
						});
		};
		const result = presentationTail.then(run, run);
		presentationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	const notifyFailure = (ctx: ExtensionContext, error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Async ask failed: ${message}`, "error");
		return message;
	};

	const deliver = (ctx: ExtensionContext, message: string): boolean => {
		try {
			deliverSteer?.(message);
			return true;
		} catch (error) {
			notifyFailure(ctx, error);
			return false;
		}
	};

	const close = (ctx: ExtensionContext, id: string) => {
		activeSteers.delete(id);
		try {
			onPendingChange?.({ version: 1, state: "closed", id });
		} catch (error) {
			notifyFailure(ctx, error);
		}
	};

	const startSteer = (
		request: PendingAsk,
		ctx: ExtensionContext,
		persist: boolean,
	) => {
		if (activeSteers.has(request.id) || sessionAbort.signal.aborted) return;
		if (persist) {
			onPendingChange?.({
				version: 1,
				state: "pending",
				id: request.id,
				prompts: request.prompts,
			});
		}
		activeSteers.add(request.id);
		const requestGeneration = generation;
		void present(ctx, request.prompts, {
			steering: true,
			signal: sessionAbort.signal,
		}).then(
			(responses) => {
				if (requestGeneration !== generation || sessionAbort.signal.aborted)
					return;
				if (deliver(ctx, steerResponse(request.prompts, responses)))
					close(ctx, request.id);
			},
			(error: unknown) => {
				if (requestGeneration !== generation || sessionAbort.signal.aborted)
					return;
				const message = notifyFailure(ctx, error);
				if (
					deliver(
						ctx,
						`The asynchronous ask failed before I could answer: ${message}`,
					)
				)
					close(ctx, request.id);
			},
		);
	};

	return {
		canSteer: deliverSteer !== undefined,
		present,
		requestSteer(request: PendingAsk, ctx: ExtensionContext) {
			startSteer(request, ctx, true);
		},
		restorePending(pending: readonly PendingAsk[], ctx: ExtensionContext) {
			generation++;
			sessionAbort.abort();
			sessionAbort = new AbortController();
			presentationTail = Promise.resolve();
			activeSteers.clear();
			if ((!askInComposer && !ctx.hasUI) || !deliverSteer) return;
			for (const request of pending) startSteer(request, ctx, false);
		},
		shutdown() {
			generation++;
			sessionAbort.abort();
			activeSteers.clear();
		},
		get sessionSignal(): AbortSignal {
			return sessionAbort.signal;
		},
	};
}
