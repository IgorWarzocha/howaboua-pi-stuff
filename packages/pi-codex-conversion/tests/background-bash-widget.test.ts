import assert from "node:assert/strict";
import test from "node:test";
import { renderBackgroundBashWidget } from "../src/ui/background-bash-widget.ts";

test("background shell widget does not touch TUI state in headless mode", () => {
	const ctx = {
		mode: "rpc",
		ui: {
			get theme(): never {
				throw new Error("headless mode has no theme");
			},
		},
	};
	assert.doesNotThrow(() =>
		renderBackgroundBashWidget(
			ctx as never,
			{ folded: true },
			{ listSessions: () => { throw new Error("headless mode must not inspect sessions"); } } as never,
		),
	);
});
