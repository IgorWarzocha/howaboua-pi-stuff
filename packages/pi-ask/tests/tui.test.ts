import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { askInTui } from "../ask/tui.js";

describe("TUI ask cancellation", () => {
	test("dismisses the custom panel when execution aborts", async () => {
		const controller = new AbortController();
		const theme = {
			fg: (_color: string, value: string) => value,
			bg: (_color: string, value: string) => value,
		};
		const ctx = {
			hasUI: true,
			ui: {
				custom: async <T>(
					factory: (
						tui: { requestRender(): void },
						theme: unknown,
						keybindings: unknown,
						done: (result: T) => void,
					) => Component & { dispose?(): void },
				) =>
					await new Promise<T>((resolve) => {
						let component: (Component & { dispose?(): void }) | undefined;
						component = factory({ requestRender() {} }, theme, {}, (result) => {
							component?.dispose?.();
							resolve(result);
						});
						controller.abort();
					}),
			},
		} as unknown as ExtensionContext;

		const result = await askInTui(
			ctx,
			[
				{
					id: "p1",
					title: "Decision",
					multiple: false,
					choices: [],
				},
			],
			{ signal: controller.signal },
		);

		expect(result).toBeNull();
	});
});
