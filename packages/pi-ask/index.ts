import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAskConfig } from "./ask/config.js";
import { createAskTool } from "./ask/tool.js";

export { createAskTool } from "./ask/tool.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";

export default function humanInTheLoop(pi: ExtensionAPI): void {
	pi.registerTool(
		createAskTool({
			onBlockedChange: (state) => {
				pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, {
					id: state.id,
					active: state.active,
					prompt: state.prompt,
				});
				pi.events.emit("herdr:blocked", {
					active: state.active,
					label: state.label,
				});
			},
		}),
	);
	pi.on("resources_discover", () => {
		const config = loadAskConfig();
		return {
			promptPaths: [
				...(config.grill ? [join(PROMPTS_DIR, "grill.md")] : []),
				...(config.fold ? [join(PROMPTS_DIR, "fold.md")] : []),
			],
		};
	});
}
