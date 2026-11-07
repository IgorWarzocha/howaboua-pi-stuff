import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBoardFeature } from "./src/board/feature.js";
import { createNotesFeature } from "./src/notes/feature.js";
import type {
	FeatureSettings,
	OpenSettings,
} from "./src/settings-navigation.js";

export default async function agentComms(pi: ExtensionAPI): Promise<void> {
	let board: FeatureSettings;
	const open: OpenSettings = async (ctx, initial) => {
		let tab: typeof initial | undefined = initial;
		while (tab) {
			tab = await (tab === "notes" ? notes : board).openSettings(ctx);
		}
	};
	const notes = createNotesFeature(pi, open);
	board = await createBoardFeature(pi, open);
}
