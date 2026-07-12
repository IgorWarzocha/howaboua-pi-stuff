import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOpenAICodexCustomProvider } from "../providers/openai-codex-custom-provider.ts";
import { registerCodexCommand } from "../ui/settings/command.ts";
import { registerCodexCodeMode } from "../adapter/code-mode.ts";
import { registerCodexEvents } from "./events.ts";
import { createCodexExtensionRuntime } from "./runtime.ts";
import { registerCodexTools } from "./tools.ts";
import { registerCodexUi } from "./ui.ts";

export async function registerCodexConversion(pi: ExtensionAPI): Promise<void> {
	const runtime = createCodexExtensionRuntime(pi);
	const codeMode = await registerCodexCodeMode(pi, runtime);
	registerOpenAICodexCustomProvider(pi, {
		getConfig: () => ({ openai: runtime.state.config.openai, beta: runtime.state.config.beta }),
		turnState: runtime.state.codexTurnState,
	});
	const tools = registerCodexTools(pi, runtime);
	const ui = registerCodexUi(pi, runtime);
	registerCodexCommand(pi, runtime.state, (config) => {
		tools.applyConfig(config);
		ui.applyConfig(config);
	}, { sessions: runtime.sessions, widget: runtime.backgroundWidget });
	registerCodexEvents(pi, runtime, tools, ui, codeMode);
}
