import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAskConfig } from "./ask/config.js";
import { createAskTool } from "./ask/tool.js";
import registerPackageChangelog from "./changelog.js";

export { createAskTool } from "./ask/tool.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";

export default async function humanInTheLoop(pi: ExtensionAPI): Promise<void> {
	registerPackageChangelog(pi);
	const ask = createAskTool({
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
	});
	pi.registerTool(ask);
	await registerAskInCodeMode(pi, ask);
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

async function registerAskInCodeMode(
	pi: ExtensionAPI,
	ask: ReturnType<typeof createAskTool>,
): Promise<void> {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const unregister = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(ask, {
				blocking: true,
				usage:
					"await tools.ask({ prompts: [{ title, body?, multiple?, choices?: [{ label, description? }] }], handoff? })",
			}),
		]);
		pi.on("session_shutdown", () => unregister());
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return;
		throw error;
	}
}

function isMissingCodeModeExtension(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			(error.code === "ERR_MODULE_NOT_FOUND" ||
				error.code === "MODULE_NOT_FOUND") &&
			"message" in error &&
			typeof error.message === "string" &&
			error.message.includes("@howaboua/pi-codex-conversion"),
	);
}
