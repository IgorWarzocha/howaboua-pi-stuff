import { expect, test } from "bun:test";
import type { createAskTool } from "../ask/tool.js";
import humanInTheLoop from "../index.js";

test("reports open prompts through Pi's event bus", async () => {
	let tool: ReturnType<typeof createAskTool> | undefined;
	const events: Array<{ channel: string; data: unknown }> = [];
	humanInTheLoop({
		registerTool: (definition: unknown) => {
			tool = definition as ReturnType<typeof createAskTool>;
		},
		on: () => {},
		events: {
			emit: (channel: string, data: unknown) => events.push({ channel, data }),
		},
	} as never);

	const answers = ["Proceed", ""];
	await tool?.execute(
		"call-1",
		{ prompts: [{ title: "Choose a path" }] },
		undefined,
		undefined,
		{
			hasUI: true,
			mode: "rpc",
			ui: { input: async () => answers.shift() },
		} as never,
	);

	const voicePrompt = (events[0]?.data as { prompt?: unknown } | undefined)
		?.prompt;
	expect(typeof voicePrompt).toBe("string");
	expect(events).toEqual([
		{
			channel: "@howaboua/pi-codex-conversion/realtime-voice-prompt/v1",
			data: {
				id: "call-1",
				active: true,
				prompt: voicePrompt,
			},
		},
		{
			channel: "herdr:blocked",
			data: { active: true, label: "Waiting for input" },
		},
		{
			channel: "@howaboua/pi-codex-conversion/realtime-voice-prompt/v1",
			data: {
				id: "call-1",
				active: false,
				prompt: voicePrompt,
			},
		},
		{
			channel: "herdr:blocked",
			data: { active: false, label: "Waiting for input" },
		},
	]);
});
