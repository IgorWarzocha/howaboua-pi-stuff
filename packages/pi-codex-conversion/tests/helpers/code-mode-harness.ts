import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../../src/adapter/activation/config.ts";
import { registerCodexCodeMode } from "../../src/adapter/code-mode.ts";
import { createCodexTurnState } from "../../src/providers/openai-codex/turn-state.ts";
import { createExecCommandTracker } from "../../src/tools/exec/command-state.ts";
import { createExecSessionManager } from "../../src/tools/exec/session-manager.ts";

export async function createCodeModeHarness() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
	const pi = {
		events: {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		on(event: string, handler: (...args: any[]) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const sessions = createExecSessionManager({ env: process.env });
	const runtime = {
		state: {
			enabled: true,
			cwd: process.cwd(),
			promptSkills: [],
			config: structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG),
			codexTurnState: createCodexTurnState(),
		},
		tracker: createExecCommandTracker(),
		sessions,
	} as never;
	(runtime as any).state.config.beta.codeMode = true;
	const codeMode = await registerCodexCodeMode(pi as never, runtime);
	return {
		tools,
		handlers,
		runtime,
		async close() {
			await codeMode.shutdown();
			sessions.shutdown();
		},
	};
}
