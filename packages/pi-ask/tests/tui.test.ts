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

	test("uses configured navigation keys and theme-native colors", async () => {
		const colors: string[] = [];
		const screens: string[] = [];
		const theme = {
			fg: (color: string, value: string) => {
				colors.push(color);
				return value;
			},
			bg: (color: string, value: string) => {
				colors.push(color);
				return value;
			},
		};
		const bindings = new Map<string, string[]>([
			["tui.select.up", ["k"]],
			["tui.select.down", ["j"]],
			["tui.select.confirm", ["x"]],
			["tui.select.cancel", ["q"]],
			["tui.editor.cursorLeft", ["h"]],
			["tui.editor.cursorRight", ["l"]],
			["tui.input.submit", ["s"]],
			["tui.input.tab", ["t"]],
		]);
		const keybindings = {
			matches: (data: string, action: string) =>
				bindings.get(action)?.includes(data) ?? false,
			getKeys: (action: string) => bindings.get(action) ?? [],
		};
		const ctx = {
			hasUI: true,
			ui: {
				custom: async <T>(
					factory: (
						tui: {
							requestRender(): void;
							terminal: { rows: number };
						},
						theme: unknown,
						keybindings: unknown,
						done: (result: T) => void,
					) => Component,
				) =>
					await new Promise<T>((resolve) => {
						const component = factory(
							{ requestRender() {}, terminal: { rows: 40 } },
							theme,
							keybindings,
							resolve,
						);
						const render = () => screens.push(component.render(160).join("\n"));
						render();
						for (const data of ["j", "k", "j", "x", "t", "j", "j", "x"]) {
							component.handleInput?.(data);
						}
						render();
						component.handleInput?.("q");
						for (const data of ["k", "k", "x", "l", "h", "l"]) {
							component.handleInput?.(data);
						}
						render();
						component.handleInput?.("x");
					}),
			},
		} as unknown as ExtensionContext;

		const result = await askInTui(
			ctx,
			[
				{
					id: "p1",
					title: "First",
					multiple: false,
					choices: [{ label: "A" }, { label: "B" }],
				},
				{
					id: "p2",
					title: "Second",
					multiple: false,
					choices: [{ label: "C" }, { label: "D" }],
				},
			],
			{ handoff: true },
		);

		expect(result?.map((response) => response.selections)).toEqual([
			["B"],
			["C"],
		]);
		expect(screens[0]).toContain("j down");
		expect(screens[0]).toContain("x choose/type");
		expect(screens[1]).toContain("s save");
		expect(screens[1]).toContain("q cancel edit");
		expect(screens[2]).toContain("h previous prompt");
		expect(screens[2]).toContain("l next prompt");
		expect(colors).not.toContain("warning");
	});
});
