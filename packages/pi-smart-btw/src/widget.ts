import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KEY_HINT, WIDGET_ID } from "./constants.js";
import { listSessions, sessionStatus } from "./session-state.js";
import type { BtwSession, BtwState } from "./types.js";

const KEY_HINT_PREFIX = /^keys\s+/u;

function tuiKeyHint() {
	return KEY_HINT.replace(KEY_HINT_PREFIX, "");
}

function truncateQuestion(question: string) {
	return question.length > 120 ? `${question.slice(0, 117)}...` : question;
}

function sessionLabel(
	theme: ExtensionContext["ui"]["theme"],
	session: BtwSession,
	activeIndex: number,
) {
	const label = String(session.index + 1);
	if (session.index === activeIndex) return theme.fg("accent", `[${label}]`);
	const status = sessionStatus(session);
	if (status === "running") return theme.fg("warning", label);
	if (status === "unread") return theme.fg("success", label);
	return theme.fg("dim", label);
}

function pushTurnLines(
	lines: string[],
	theme: ExtensionContext["ui"]["theme"],
	turn: BtwSession["turns"][number],
) {
	lines.push(`${theme.fg("muted", "│ Q")} ${truncateQuestion(turn.question)}`);
	if (turn.error) {
		lines.push(`${theme.fg("error", "│ ✗")} ${turn.error}`);
		return;
	}
	const answer = turn.answer || turn.partial;
	if (!answer) {
		lines.push(`${theme.fg("warning", "│ … thinking")}`);
		return;
	}
	if (turn.answer)
		lines.push(
			`${theme.fg("success", "│ ✓ answered — see btw result in transcript")}`,
		);
	else lines.push(`${theme.fg("warning", "│ … thinking")}`);
}

function buildWidgetLines(
	ctx: ExtensionContext,
	state: BtwState,
	session: BtwSession,
) {
	const theme = ctx.ui.theme;
	const sessions = listSessions(state);
	const status = sessionStatus(session);
	const statusTone =
		status === "running"
			? "warning"
			: status === "failed"
				? "error"
				: "success";
	const sessionNumbers = sessions
		.map((item) => sessionLabel(theme, item, state.activeIndex))
		.join(" ");
	const lines = [
		`${theme.fg("accent", "╭─ btw")} ${theme.fg(statusTone, status)} ${theme.fg("dim", `sessions ${sessionNumbers}`)}`,
	];
	if (state.folded) {
		lines.push(`${theme.fg("muted", "╰─")} ${theme.fg("dim", tuiKeyHint())}`);
		return lines;
	}
	for (const turn of session.turns.slice(-3)) pushTurnLines(lines, theme, turn);
	lines.push(`${theme.fg("muted", "╰─")} ${theme.fg("dim", tuiKeyHint())}`);
	return lines;
}

export function render(ctx: ExtensionContext, state: BtwState) {
	const sessions = listSessions(state);
	if (sessions.length === 0) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}
	const session = state.sessions[state.activeIndex] ?? sessions[0]!;
	ctx.ui.setWidget(WIDGET_ID, buildWidgetLines(ctx, state, session), {
		placement: "aboveEditor",
	});
}
