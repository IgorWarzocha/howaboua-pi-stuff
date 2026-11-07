import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BoardAwareness } from "../awareness.js";
import { BoardSummarizer } from "../summarizer.js";
import { activateBoard } from "./activation.js";
import { BoardCatchup } from "./catchup.js";
import type { BoardRuntime } from "./coordinator.js";
import { BoardTurns } from "./turns.js";

/** Optional inference, turn delivery and summary machinery, loaded only when on. */
export async function createBoardEngine(
	pi: ExtensionAPI,
	runtime: BoardRuntime,
) {
	const availability = runtime.reportAvailability.bind(runtime);
	const awareness = new BoardAwareness(
		pi,
		(ctx) => runtime.population(ctx),
		availability,
		() => runtime.gptPromptMode,
	);
	const catchup = new BoardCatchup(
		pi,
		awareness,
		(ctx, request) => runtime.toOwner(ctx, request),
		availability,
		() => runtime.gptPromptMode,
	);
	const turns = new BoardTurns(
		pi,
		(ctx, request) => runtime.toOwner(ctx, request),
		availability,
		(ctx, ids) => awareness.markSeen(ctx, ids),
	);
	const summarizer = new BoardSummarizer();
	await activateBoard(pi, runtime);
	return { awareness, catchup, turns, summarizer };
}

export type BoardEngine = Awaited<ReturnType<typeof createBoardEngine>>;
