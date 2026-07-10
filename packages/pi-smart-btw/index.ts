import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { ensureConfig, readConfig } from "./src/config.js";
import {
	DEFAULT_SHORTCUTS,
	LEGACY_MESSAGE_TYPE,
	MAX_BTW_SESSIONS,
	MESSAGE_TYPE,
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
import {
	btwArgumentCompletions,
	handleBtwConfigArg,
} from "./src/settings/command.js";
import type { BtwState } from "./src/types.js";
import { render } from "./src/widget.js";

function activate(state: BtwState, ctx: ExtensionContext) {
	state.ctx = ctx;
	const branch = ctx.sessionManager.getBranch();
	restoreStateFromMessages(
		state,
		branch.flatMap((entry) => {
			if (entry.type === "custom" && entry.customType === MESSAGE_TYPE) {
				return [{ customType: entry.customType, details: entry.data }];
			}
			if (entry.type === "custom_message" && isBtwContextMessage(entry)) {
				return [
					{
						customType: entry.customType,
						details: entry.details,
						content: entry.content,
					},
				];
			}
			return [];
		}),
	);
}

async function injectAnswers(
	pi: ExtensionAPI,
	state: BtwState,
	ctx: ExtensionContext,
): Promise<void> {
	activate(state, ctx);
	const session = activeSession(state);
	const turns = doneTurns(session?.turns ?? []);
	if (turns.length === 0) {
		state.ctx?.ui.notify("No /btw answer to inject yet.", "warning");
		return;
	}
	if (session) {
		sendClearedMessage(pi, session);
		try {
			await clearSession(state, session);
		} catch (error) {
			ctx.ui.notify(
				`Failed to stop /btw child cleanly: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	}
	pi.sendUserMessage(
		injectionText(turns),
		state.ctx?.isIdle() ? undefined : { deliverAs: "followUp" },
	);
	if (state.ctx) render(state.ctx, state);
}

function registerShortcuts(pi: ExtensionAPI, state: BtwState) {
	const cfg = readConfig();
	pi.registerShortcut(cfg.composeShortcut as typeof DEFAULT_SHORTCUTS.compose, {
		description: "Prefill /btw in the prompt editor",
		handler: async (ctx) => {
			const current = ctx.ui.getEditorText();
			ctx.ui.setEditorText(
				current.trim() ? `${current.trimEnd()} /btw ` : "/btw ",
			);
		},
	});
	pi.registerShortcut(cfg.injectShortcut as typeof DEFAULT_SHORTCUTS.inject, {
		description: "Inject and clear active /btw session",
		handler: async (ctx) => injectAnswers(pi, state, ctx),
	});
	pi.registerShortcut(cfg.dismissShortcut as typeof DEFAULT_SHORTCUTS.clear, {
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
	pi.registerShortcut(cfg.foldShortcut as typeof DEFAULT_SHORTCUTS.fold, {
		description: "Fold active /btw block",
		handler: async (ctx) => {
			activate(state, ctx);
			state.folded = true;
			if (state.ctx) render(state.ctx, state);
		},
	});
	pi.registerShortcut(cfg.unfoldShortcut as typeof DEFAULT_SHORTCUTS.unfold, {
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
	const cfg = readConfig();
	const configuredShortcuts = new Set([
		cfg.composeShortcut,
		cfg.injectShortcut,
		cfg.dismissShortcut,
		cfg.foldShortcut,
		cfg.unfoldShortcut,
		cfg.nextShortcut,
		cfg.previousShortcut,
	]);
	const switchSession = (ctx: ExtensionContext, direction: number) => {
		activate(state, ctx);
		if (listSessions(state).length === 0) return;
		switchRelativeSession(state, direction);
		if (state.ctx) render(state.ctx, state);
	};
	pi.registerShortcut(cfg.nextShortcut as typeof DEFAULT_SHORTCUTS.next, {
		description: "Next /btw session",
		handler: async (ctx) => switchSession(ctx, 1),
	});
	pi.registerShortcut(
		cfg.previousShortcut as typeof DEFAULT_SHORTCUTS.previous,
		{
			description: "Previous /btw session",
			handler: async (ctx) => switchSession(ctx, -1),
		},
	);
	for (let index = 1; index <= 9; index++) {
		const chord = `alt+${index}`;
		if (configuredShortcuts.has(chord)) continue;
		pi.registerShortcut(chord as typeof DEFAULT_SHORTCUTS.compose, {
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
			"Async side-sessions (/btw 1 …). /btw or /btw N switches. /btw config opens settings.",
		getArgumentCompletions: (prefix) => btwArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (
				trimmed.toLowerCase() === "config" ||
				trimmed.toLowerCase().startsWith("config ")
			) {
				activate(state, ctx);
				handleBtwConfigArg(ctx, "config");
				return;
			}
			const { question, sessionNumber } = parseBtwArgs(args);
			activate(state, ctx);
			if (sessionNumber !== undefined) {
				if (sessionNumber < 1 || sessionNumber > MAX_BTW_SESSIONS) {
					ctx.ui.notify(
						`Use /btw 1 through /btw ${MAX_BTW_SESSIONS} to pick a btw session.`,
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

function renderBtwRecord(
	detailsValue: unknown,
	content: unknown,
	theme: Parameters<Parameters<ExtensionAPI["registerMessageRenderer"]>[1]>[2],
) {
	const details = (detailsValue ?? {}) as BtwMessageDetails;
	if (details.kind === "cleared") return undefined;
	const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
	const label = details.label ?? MESSAGE_TYPE;
	const status = details.error
		? theme.fg("error", `${label} failed`)
		: theme.fg("accent", label);
	const question = details.question ?? "";
	const body = details.answer ?? details.error ?? String(content ?? "");
	box.addChild(
		new Text(
			`${status} ${theme.fg("muted", "Q")} ${question}\n\n${body}`,
			0,
			0,
		),
	);
	return box;
}

function renderBtwMessage(
	message: { content?: unknown; details?: unknown },
	_options: unknown,
	theme: Parameters<Parameters<ExtensionAPI["registerMessageRenderer"]>[1]>[2],
) {
	return renderBtwRecord(message.details, message.content, theme);
}

function renderBtwEntry(
	entry: { data?: unknown },
	_options: unknown,
	theme: Parameters<Parameters<ExtensionAPI["registerEntryRenderer"]>[1]>[2],
) {
	return renderBtwRecord(entry.data, undefined, theme);
}

export default function (pi: ExtensionAPI) {
	if (process.env["PI_SMART_BTW_CHILD"] === "1") return;
	ensureConfig();
	const state = createInitialState();

	pi.registerMessageRenderer(MESSAGE_TYPE, renderBtwMessage);
	pi.registerMessageRenderer(LEGACY_MESSAGE_TYPE, renderBtwMessage);
	pi.registerEntryRenderer(MESSAGE_TYPE, renderBtwEntry);

	// Old sessions stored display-only BTW state as model-facing custom messages.
	// Keep only the read/filter path; new state uses custom entries.
	pi.on("context", async (event) => {
		const legacyMessages = btwRestoreInputsFromAgentMessages(event.messages);
		if (legacyMessages.length > 0)
			restoreStateFromMessages(state, legacyMessages);
		const messages = event.messages.filter(
			(message) =>
				!isBtwContextMessage(
					message as {
						role?: string;
						customType?: string;
						details?: unknown;
					},
				),
		);
		if (messages.length === event.messages.length) return undefined;
		return {
			messages,
		};
	});

	registerShortcuts(pi, state);
	registerBtwCommand(pi, state);

	pi.on("session_shutdown", async () => {
		for (const session of listSessions(state)) await session.child?.stop();
	});
}
