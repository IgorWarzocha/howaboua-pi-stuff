import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { ensureConfig, readConfig } from "./src/config.js";
import {
	LEGACY_MESSAGE_TYPE,
	MESSAGE_TYPE,
	SHORTCUTS,
} from "./src/constants.js";
import type { BtwMessageDetails } from "./src/messages.js";
import {
	btwRestoreInputsFromAgentMessages,
	isBtwContextMessage,
	sendClearedMessage,
	sendResultMessage,
} from "./src/messages.js";
import { doneTurns, injectionText } from "./src/output.js";
import {
	activeSession,
	clearSession,
	createInitialState,
	createSession,
	ensureSession,
	listSessions,
	parseBtwArgs,
	restoreStateFromMessages,
	runBtwTurn,
	switchRelativeSession,
} from "./src/session-state.js";
import type { BtwState } from "./src/types.js";
import { render } from "./src/widget.js";

function activate(state: BtwState, ctx: ExtensionContext) {
	state.ctx = ctx;
	const branch = ctx.sessionManager.getBranch();
	restoreStateFromMessages(
		state,
		branch
			.filter((entry) => entry.type === "custom_message")
			.map((entry) => ({
				customType: entry.customType,
				details: entry.details,
				content: entry.content,
			})),
	);
}

function injectAnswers(
	pi: ExtensionAPI,
	state: BtwState,
	ctx: ExtensionContext,
) {
	activate(state, ctx);
	const session = activeSession(state);
	const turns = doneTurns(session?.turns ?? []);
	if (turns.length === 0) {
		state.ctx?.ui.notify("No /btw answer to inject yet.", "warning");
		return;
	}
	pi.sendUserMessage(
		injectionText(turns),
		state.ctx?.isIdle() ? undefined : { deliverAs: "followUp" },
	);
	if (session) {
		sendClearedMessage(pi, session);
		void clearSession(state, session);
	}
	if (state.ctx) render(state.ctx, state);
}

function registerShortcuts(pi: ExtensionAPI, state: BtwState) {
	const cfg = readConfig();
	pi.registerShortcut(cfg.composeShortcut as typeof SHORTCUTS.compose, {
		description: "Prefill /btw in the prompt editor",
		handler: async (ctx) => {
			const current = ctx.ui.getEditorText();
			ctx.ui.setEditorText(
				current.trim() ? `${current.trimEnd()} /btw ` : "/btw ",
			);
		},
	});
	pi.registerShortcut(cfg.injectShortcut as typeof SHORTCUTS.inject, {
		description: "Inject and clear active /btw session",
		handler: async (ctx) => injectAnswers(pi, state, ctx),
	});
	pi.registerShortcut(cfg.dismissShortcut as typeof SHORTCUTS.clear, {
		description: "Clear active /btw session",
		handler: async (ctx) => {
			activate(state, ctx);
			const session = activeSession(state);
			if (session) {
				sendClearedMessage(pi, session);
				await clearSession(state, session);
			}
			if (state.ctx) render(state.ctx, state);
		},
	});
	pi.registerShortcut(SHORTCUTS.fold, {
		description: "Fold active /btw block",
		handler: async (ctx) => {
			activate(state, ctx);
			state.folded = true;
			if (state.ctx) render(state.ctx, state);
		},
	});
	pi.registerShortcut(SHORTCUTS.unfold, {
		description: "Open active /btw block",
		handler: async (ctx) => {
			activate(state, ctx);
			state.folded = false;
			const session = activeSession(state);
			if (session) session.unread = false;
			if (state.ctx) render(state.ctx, state);
		},
	});
	registerSessionSwitchShortcuts(pi, state);
}

function registerSessionSwitchShortcuts(pi: ExtensionAPI, state: BtwState) {
	const switchSession = (ctx: ExtensionContext, direction: number) => {
		activate(state, ctx);
		if (listSessions(state).length === 0) return;
		switchRelativeSession(state, direction);
		if (state.ctx) render(state.ctx, state);
	};
	pi.registerShortcut(SHORTCUTS.next, {
		description: "Next /btw session",
		handler: async (ctx) => switchSession(ctx, 1),
	});
	pi.registerShortcut(SHORTCUTS.previous, {
		description: "Previous /btw session",
		handler: async (ctx) => switchSession(ctx, -1),
	});
	for (let index = 1; index <= 9; index++) {
		pi.registerShortcut(`ctrl+alt+${index}` as typeof SHORTCUTS.compose, {
			description: `Open /btw session ${index}`,
			handler: async (ctx) => {
				activate(state, ctx);
				ensureSession(state, index - 1);
				if (state.ctx) render(state.ctx, state);
			},
		});
	}
}

function queueQuestionTurn(args: {
	ctx: ExtensionCommandContext;
	pi: ExtensionAPI;
	question: string;
	state: BtwState;
}) {
	const { ctx, pi, question, state } = args;
	const session = activeSession(state) ?? createSession(state);
	const turn = {
		question,
		startedAt: Date.now(),
		status: "queued" as const,
	};
	session.turns.push(turn);
	state.folded = false;
	session.unread = false;
	render(ctx, state);
	const generation = session.generation;
	session.queue = session.queue
		.catch(() => undefined)
		.then(() =>
			runBtwTurn({
				ctx,
				pi,
				question,
				state,
				session,
				turn,
				generation,
				sendResultMessage,
				render,
			}),
		);
}

function registerBtwCommand(pi: ExtensionAPI, state: BtwState) {
	pi.registerCommand("btw", {
		description:
			"Ask or continue an async side-session. Use /btw 1, /btw 2, etc. to switch or target sessions.",
		handler: async (args, ctx) => {
			const { question, sessionNumber } = parseBtwArgs(args);
			activate(state, ctx);
			if (sessionNumber !== undefined) {
				if (sessionNumber < 1) {
					ctx.ui.notify(
						"Use /btw 1, /btw 2, etc. to pick a btw session.",
						"warning",
					);
					return;
				}
				ensureSession(state, sessionNumber - 1);
			}
			if (!question) {
				state.folded = false;
				const session = activeSession(state);
				if (session) session.unread = false;
				render(ctx, state);
				return;
			}
			queueQuestionTurn({ ctx, pi, question, state });
		},
	});
}

function renderBtwMessage(
	message: { content?: unknown; details?: unknown },
	_options: unknown,
	theme: Parameters<Parameters<ExtensionAPI["registerMessageRenderer"]>[1]>[2],
) {
	const details = (message.details ?? {}) as BtwMessageDetails;
	if (details.kind === "cleared") return undefined;
	const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
	const label = details.label ?? MESSAGE_TYPE;
	const status = details.error
		? theme.fg("error", `${label} failed`)
		: theme.fg("accent", label);
	const question = details.question ?? "";
	const body = details.answer ?? details.error ?? String(message.content ?? "");
	box.addChild(
		new Text(
			`${status} ${theme.fg("muted", "Q")} ${question}\n\n${body}`,
			0,
			0,
		),
	);
	return box;
}

export default function (pi: ExtensionAPI) {
	if (process.env["PI_SMART_BTW_CHILD"] === "1") return;
	ensureConfig();
	const state = createInitialState();

	pi.registerMessageRenderer(MESSAGE_TYPE, renderBtwMessage);
	pi.registerMessageRenderer(LEGACY_MESSAGE_TYPE, renderBtwMessage);

	pi.on("context", async (event) => {
		restoreStateFromMessages(
			state,
			btwRestoreInputsFromAgentMessages(event.messages),
		);
		return {
			messages: event.messages.filter(
				(message) =>
					!isBtwContextMessage(
						message as {
							role?: string;
							customType?: string;
							details?: unknown;
						},
					),
			),
		};
	});

	registerShortcuts(pi, state);
	registerBtwCommand(pi, state);

	pi.on("session_shutdown", async () => {
		for (const session of listSessions(state)) await session.child?.stop();
	});
}
