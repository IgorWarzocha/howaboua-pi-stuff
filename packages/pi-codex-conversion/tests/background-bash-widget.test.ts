import test from "node:test";
import assert from "node:assert/strict";
import { renderBackgroundBashWidget } from "../src/ui/background-bash-widget.ts";

test("background shell widget skips rendering outside TUI mode", () => {
	let listed = false;
	const ctx = {
		mode: "rpc",
		ui: {
			get theme(): never {
				throw new Error("Theme not initialized");
			},
			setWidget: () => assert.fail("RPC widget should not render"),
		},
	} as never;
	const sessions = {
		listSessions: () => {
			listed = true;
			return [];
		},
	} as never;

	renderBackgroundBashWidget(ctx, { folded: true }, sessions);
	assert.equal(listed, false);
});
