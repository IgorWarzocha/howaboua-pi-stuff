import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	CURSOR_MARKER,
	isFocusable,
	KeybindingsManager,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { askInTui } from "../ask/tui.js";

describe("TUI ask cancellation", () => {
	test("propagates editor focus and dismisses when execution aborts", async () => {
		const controller = new AbortController();
		const theme = {
			fg: (_color: string, value: string) => value,
			bg: (_color: string, value: string) => value,
			bold: (value: string) => value,
		};
		const ctx = {
			hasUI: true,
			ui: {
				custom: async <T>(
					factory: (
						tui: { requestRender(): void; terminal: { rows: number } },
						theme: unknown,
						keybindings: unknown,
						done: (result: T) => void,
					) => Component & { dispose?(): void },
				) =>
					await new Promise<T>((resolve) => {
						let component: (Component & { dispose?(): void }) | undefined;
						component = factory(
							{ requestRender() {}, terminal: { rows: 40 } },
							theme,
							new KeybindingsManager(TUI_KEYBINDINGS),
							(result) => {
								component?.dispose?.();
								resolve(result);
							},
						);
						if (!isFocusable(component))
							throw new Error("Ask panel must forward focus");
						component.focused = true;
						component.handleInput?.("\r");
						expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
						component.focused = false;
						expect(component.render(80).join("\n")).not.toContain(
							CURSOR_MARKER,
						);
						component.focused = true;
						expect(component.render(80).join("\n")).toContain(CURSOR_MARKER);
						component.handleInput?.("\x1b");
						expect(component.render(80).join("\n")).not.toContain(
							CURSOR_MARKER,
						);
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
