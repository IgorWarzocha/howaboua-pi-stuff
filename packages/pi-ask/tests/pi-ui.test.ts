import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REPHRASE_REQUEST_RESPONSE } from "../ask/constants.js";
import type { AskPrompt } from "../ask/contracts.js";
import { askWithPiUi } from "../ask/pi-ui.js";

const prompt = (overrides: Partial<AskPrompt> = {}): AskPrompt => ({
	id: "p1",
	title: "Decision",
	multiple: false,
	choices: [],
	...overrides,
});

describe("Pi UI ask fallback", () => {
	test("keeps blank free text as a rephrase request and forwards the signal", async () => {
		const controller = new AbortController();
		const signals: Array<AbortSignal | undefined> = [];
		const titles: string[] = [];
		const values: Array<string | undefined> = ["", ""];
		const ctx = {
			hasUI: true,
			ui: {
				input: async (
					title: string,
					_placeholder: string,
					options: { signal?: AbortSignal },
				) => {
					titles.push(title);
					signals.push(options.signal);
					return values.shift();
				},
			},
		} as unknown as ExtensionContext;

		const result = await askWithPiUi(ctx, [prompt()], {
			steering: true,
			signal: controller.signal,
		});

		expect(result?.[0]?.selections).toEqual([REPHRASE_REQUEST_RESPONSE]);
		expect(titles[0]).toContain("Agent continues while you decide");
		expect(signals).toEqual([controller.signal, controller.signal]);
	});

	test("treats closing the optional comment as dismissal", async () => {
		const values: Array<string | undefined> = ["Answer", undefined];
		const ctx = {
			hasUI: true,
			ui: {
				input: async () => values.shift(),
			},
		} as unknown as ExtensionContext;

		expect(await askWithPiUi(ctx, [prompt()])).toBeNull();
	});

	test("allows a multi-select choice labeled Done", async () => {
		const shownOptions: string[][] = [];
		let call = 0;
		const ctx = {
			hasUI: true,
			ui: {
				select: async (_title: string, options: string[]) => {
					shownOptions.push(options);
					call++;
					return call === 1 ? "Done" : options.at(-1);
				},
				input: async () => "",
			},
		} as unknown as ExtensionContext;

		const result = await askWithPiUi(ctx, [
			prompt({
				multiple: true,
				choices: [{ label: "Done" }, { label: "Finish selection" }],
			}),
		]);

		expect(result?.[0]?.selections).toEqual(["Done"]);
		expect(shownOptions[0]?.at(-1)).toBe("Finish selection (2)");
	});
});
