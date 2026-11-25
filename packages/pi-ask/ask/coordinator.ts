import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskPrompt, AskResponse, PendingAsk } from "./contracts.js";
import { normalizeResponses, summarizeResponses } from "./normalize.js";
import type { PendingAskUpdate } from "./pending.js";
import { askWithPiUi } from "./pi-ui.js";
import { AskRequests, type RequestChange } from "./requests.js";
import { askInTui } from "./tui.js";

type AskInComposer = (
	prompts: AskPrompt[],
	signal: AbortSignal | undefined,
) => Promise<unknown>;

export interface AskCoordinatorOptions {
	askInComposer?: AskInComposer;
	deliverSteer?: (message: string) => void;
	onPendingChange?: (update: PendingAskUpdate) => void;
	onRequestChange?: (change: RequestChange) => void;
}

interface PresentAskOptions {
	id: string;
	onActiveChange?: (active: boolean) => void;
	handoff?: boolean;
	steering?: boolean;
	signal?: AbortSignal;
}

function steerResponse(prompts: AskPrompt[], responses: unknown): string {
	const normalized = normalizeResponses(prompts, responses);
	return normalized
		? `Earlier ask response:\n${summarizeResponses(prompts, normalized)}`
		: `User dismissed earlier ask: ${prompts.map((prompt) => prompt.title).join("; ")}`;
}

export function createAskCoordinator({
	askInComposer,
	deliverSteer,
	onPendingChange,
	onRequestChange,
}: AskCoordinatorOptions = {}) {
	const requests = new AskRequests(onRequestChange);
	let generation = 0;
	let sessionAbort = new AbortController();
	let presentationTail = Promise.resolve();
	const activeSteers = new Set<string>();

	const present = (
		ctx: ExtensionContext,
		prompts: AskPrompt[],
		{
			id,
			handoff = false,
			steering = false,
			signal,
			onActiveChange,
		}: PresentAskOptions,
	): Promise<unknown> => {
		const request = requests.open({ id, prompts, handoff, steering }, signal);
		const run = async () => {
			if (request.signal.aborted) return;
			try {
				onActiveChange?.(true);
				const response = askInComposer
					? await askInComposer(prompts, request.signal)
					: ctx.mode === "tui"
						? await askInTui(ctx, prompts, {
								handoff,
								steering,
								signal: request.signal,
							})
						: await askWithPiUi(ctx, prompts, {
								handoff,
								steering,
								signal: request.signal,
							});
				request.select(response);
			} catch (error) {
				request.fail(error);
			} finally {
				onActiveChange?.(false);
			}
		};
		const result = presentationTail.then(run, run);
		presentationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return request.response;
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

	const close = (
		ctx: ExtensionContext,
		id: string,
		responses?: AskResponse[],
	): boolean => {
		activeSteers.delete(id);
		try {
			onPendingChange?.({
				version: 1,
				state: "closed",
				id,
				...(responses ? { responses } : { dismissed: true }),
			});
			return true;
		} catch (error) {
			notifyFailure(ctx, error);
			return false;
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
			id: request.id,
			steering: true,
			signal: sessionAbort.signal,
		})
			.then(
				(responses) => {
					if (requestGeneration !== generation || sessionAbort.signal.aborted)
						return;
					if (deliver(ctx, steerResponse(request.prompts, responses))) {
						const saved = close(
							ctx,
							request.id,
							normalizeResponses(request.prompts, responses) ?? undefined,
						);
						requests.complete(
							request.id,
							saved
								? undefined
								: "Answer delivered, but question state could not be saved; inspect the agent before retrying",
						);
					} else {
						requests.complete(
							request.id,
							"Answer could not be delivered; the question is open again",
						);
						activeSteers.delete(request.id);
						startSteer(request, ctx, false);
					}
				},
				(error: unknown) => {
					if (requestGeneration !== generation || sessionAbort.signal.aborted)
						return;
					const message = notifyFailure(ctx, error);
					if (deliver(ctx, `Steering ask failed before answer: ${message}`)) {
						const saved = close(ctx, request.id);
						requests.complete(
							request.id,
							saved
								? undefined
								: "Question state could not be saved; inspect the agent before retrying",
						);
					} else requests.complete(request.id, message);
				},
			)
			.catch((error: unknown) => {
				if (requestGeneration !== generation || sessionAbort.signal.aborted)
					return;
				requests.complete(request.id, String(error));
				notifyFailure(ctx, error);
			});
	};

	return {
		canSteer: deliverSteer !== undefined,
		present,
		reply: (id: string, message: string) => requests.reply(id, message),
		complete: (id: string, error?: string) => requests.complete(id, error),
		requestSteer(request: PendingAsk, ctx: ExtensionContext) {
			startSteer(request, ctx, true);
		},
		restorePending(pending: readonly PendingAsk[], ctx: ExtensionContext) {
			generation++;
			requests.reset();
			sessionAbort.abort();
			sessionAbort = new AbortController();
			presentationTail = Promise.resolve();
			activeSteers.clear();
			if ((!askInComposer && !ctx.hasUI) || !deliverSteer) return;
			for (const request of pending) startSteer(request, ctx, false);
		},
		shutdown() {
			generation++;
			requests.reset();
			sessionAbort.abort();
			activeSteers.clear();
		},
		get sessionSignal(): AbortSignal {
			return sessionAbort.signal;
		},
	};
}
