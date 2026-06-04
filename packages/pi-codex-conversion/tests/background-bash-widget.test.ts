import test from "node:test";
import assert from "node:assert/strict";
import { renderBackgroundBashWidget, type BackgroundBashWidgetState } from "../src/tools/background-bash-widget.ts";
import type { ExecSessionManager, ExecSessionSnapshot } from "../src/tools/exec-session-manager.ts";

function createTheme() {
	return {
		fg: (_role: string, text: string) => text,
	};
}

function createContext() {
	let widget: string[] | undefined;
	return {
		ctx: {
			ui: {
				theme: createTheme(),
				setWidget(_id: string, content: string[] | undefined) {
					widget = content;
				},
			},
		} as any,
		getWidget: () => widget,
	};
}

function createSessions(snapshots: ExecSessionSnapshot[]): ExecSessionManager {
	return {
		listSessions: () => snapshots,
	} as any;
}

test("background bash widget hides when there are no sessions", () => {
	const { ctx, getWidget } = createContext();
	const state: BackgroundBashWidgetState = { activeSessionId: 3, folded: false };
	renderBackgroundBashWidget(ctx, state, createSessions([]));
	assert.equal(getWidget(), undefined);
	assert.deepEqual(state, { activeSessionId: undefined, folded: true });
});

test("background bash widget renders active session command and output", () => {
	const { ctx, getWidget } = createContext();
	const now = Date.now();
	const state: BackgroundBashWidgetState = { activeSessionId: 2, folded: false };
	renderBackgroundBashWidget(
		ctx,
		state,
		createSessions([
			{ id: 1, command: "sleep 5", running: true, startedAt: now, updatedAt: now, outputTail: "", terminating: false },
			{ id: 2, command: "bun dev", running: true, startedAt: now, updatedAt: now, outputTail: "ready\nlistening", terminating: false },
		]),
	);

	assert.deepEqual(getWidget(), [
		"╭─ codex shell running sessions 1 [2]",
		"│ $ bun dev",
		"│ ready",
		"│ listening",
		"│ session 2 · updated 0s ago",
		"╰─ alt+q/e select · alt+w fold/open · alt+r close · /codex ps",
	]);
});

