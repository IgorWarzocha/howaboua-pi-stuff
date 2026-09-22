import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_GPT_SWITCHER_CONFIG } from "../config.js";
import gptSwitcher from "../index.js";

type CommandHandler = (args: string, ctx: ExtensionContext) => unknown;

test("reports model authentication failures without changing reasoning", async () => {
	const notifications: string[] = [];
	const modelQueries: string[] = [];
	const pi = {
		events: {
			emit(_channel: string, event: unknown) {
				(event as { accept?: () => void }).accept?.();
			},
		},
		registerCommand(_name: string, options: { handler: CommandHandler }) {
			void options;
		},
		setModel: async () => {
			throw new Error("No API key for openai-codex/gpt-6-sol");
		},
		setThinkingLevel() {
			throw new Error("reasoning level should not change");
		},
		getThinkingLevel: () => "high",
	} as unknown as ExtensionAPI;
	const ctx = {
		modelRegistry: {
			find: (provider: string, modelId: string) => {
				modelQueries.push(`${provider}/${modelId}`);
				return { id: "gpt-6-sol", name: "GPT-6 Sol" };
			},
		},
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext;
	const commands = new Map<string, { handler: CommandHandler }>();
	pi.registerCommand = ((
		name: string,
		options: { handler: CommandHandler },
	) => {
		commands.set(name, options);
	}) as typeof pi.registerCommand;

	gptSwitcher(pi, {
		getConfig: () => structuredClone(DEFAULT_GPT_SWITCHER_CONFIG),
	});
	await commands.get("sol")?.handler("", ctx);

	expect(modelQueries).toEqual(["openai-codex/gpt-6-sol"]);
	expect(notifications).toEqual([
		"Could not switch to GPT-6 Sol: No API key for openai-codex/gpt-6-sol",
	]);
});
