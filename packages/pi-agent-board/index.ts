import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBoardFeature } from "./src/board/feature.js";
import { registerCommunicationGuidance } from "./src/guidance.js";

export default async function agentBoard(pi: ExtensionAPI): Promise<void> {
	const board = await createBoardFeature(pi);
	registerCommunicationGuidance(pi, undefined, board);
}
