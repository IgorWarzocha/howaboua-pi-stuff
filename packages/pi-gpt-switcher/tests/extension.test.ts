import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import gptSwitcher from "../index.js";

type CommandHandler = (args: string, ctx: ExtensionContext) => unknown;

test("registers model commands and switches model plus reasoning level", async () => {
	const commands = new Map<string, { handler: CommandHandler }>();
	const notifications: string[] = [];
	const model = { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" };
	let selectedModel: unknown;
	let selectedThinkingLevel: unknown;
	let currentThinkingLevel = "high";

	gptSwitcher({
		registerCommand(name, options) {
			commands.set(name, options as { handler: CommandHandler });
		},
		setModel: async (next) => {
			selectedModel = next;
			return true;
		},
		setThinkingLevel: (level) => {
			selectedThinkingLevel = level;
			currentThinkingLevel = level;
		},
		getThinkingLevel: () => currentThinkingLevel,
	} as unknown as ExtensionAPI);

	const ctx = {
		model: undefined,
		modelRegistry: {
			find(provider: string, id: string) {
				expect(provider).toBe("openai-codex");
				expect(id).toBe("gpt-5.6-luna");
				return model;
			},
		},
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
		},
	} as unknown as ExtensionContext;

	expect([...commands.keys()]).toEqual(["sol", "terra", "luna"]);
	await commands.get("luna")?.handler("low", ctx);

	expect(selectedModel).toBe(model);
	expect(selectedThinkingLevel).toBe("low");
	expect(notifications).toEqual(["Switched to GPT-5.6 Luna (low)"]);
});

test("reports model authentication failures without changing reasoning", async () => {
	const notifications: string[] = [];
	const pi = {
		registerCommand(_name: string, options: { handler: CommandHandler }) {
			void options;
		},
		setModel: async () => {
			throw new Error("No API key for openai-codex/gpt-5.6-sol");
		},
		setThinkingLevel() {
			throw new Error("reasoning level should not change");
		},
		getThinkingLevel: () => "high",
	} as unknown as ExtensionAPI;
	const ctx = {
		modelRegistry: { find: () => ({ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }) },
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext;
	const commands = new Map<string, { handler: CommandHandler }>();
	pi.registerCommand = ((
		name: string,
		options: { handler: CommandHandler },
	) => {
		commands.set(name, options);
	}) as typeof pi.registerCommand;

	gptSwitcher(pi);
	await commands.get("sol")?.handler("", ctx);

	expect(notifications).toEqual([
		"Could not switch to GPT-5.6 Sol: No API key for openai-codex/gpt-5.6-sol",
	]);
});
