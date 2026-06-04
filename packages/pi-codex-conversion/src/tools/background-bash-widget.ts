import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/config.ts";
import type { ExecSessionManager, ExecSessionSnapshot } from "./exec-session-manager.ts";

export const BACKGROUND_BASH_WIDGET_ID = "codex-background-bashes";
const OUTPUT_TAIL_CHARS = 4_000;

export interface BackgroundBashWidgetState {
	activeSessionId?: number | undefined;
	folded: boolean;
	ctx?: ExtensionContext | undefined;
}

function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function ageLabel(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h`;
}

function statusLabel(session: ExecSessionSnapshot): { text: string; tone: "warning" | "success" | "error" } {
	if (session.terminating) return { text: "terminating", tone: "warning" };
	if (session.running) return { text: "running", tone: "warning" };
	if (session.exitCode === 0) return { text: "exited 0", tone: "success" };
	return { text: `failed ${session.exitCode ?? "?"}`, tone: "error" };
}

function sessionLabel(ctx: ExtensionContext, session: ExecSessionSnapshot, activeSessionId: number): string {
	const theme = ctx.ui.theme;
	const label = String(session.id);
	if (session.id === activeSessionId) return theme.fg("accent", `[${label}]`);
	if (session.running) return theme.fg("warning", label);
	return theme.fg(session.exitCode === 0 ? "success" : "error", label);
}

function resolveActiveSessionId(state: BackgroundBashWidgetState, snapshots: ExecSessionSnapshot[]): number {
	const requested = state.activeSessionId;
	if (requested !== undefined && snapshots.some((session) => session.id === requested)) return requested;
	const fallback = snapshots[0]!.id;
	state.activeSessionId = fallback;
	return fallback;
}

export function renderBackgroundBashWidget(ctx: ExtensionContext, state: BackgroundBashWidgetState, sessions: ExecSessionManager): void {
	const snapshots = sessions.listSessions(OUTPUT_TAIL_CHARS);
	if (snapshots.length === 0) {
		state.activeSessionId = undefined;
		state.folded = true;
		ctx.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
		return;
	}
	const activeSessionId = resolveActiveSessionId(state, snapshots);
	const active = snapshots.find((session) => session.id === activeSessionId) ?? snapshots[0]!;
	const activeStatus = statusLabel(active);
	const theme = ctx.ui.theme;
	const sessionNumbers = snapshots.map((session) => sessionLabel(ctx, session, active.id)).join(" ");
	const lines = [
		`${theme.fg("accent", "╭─ codex shell")} ${theme.fg(activeStatus.tone, activeStatus.text)} ${theme.fg("dim", `sessions ${sessionNumbers}`)}`,
	];

	if (!state.folded) {
		lines.push(`${theme.fg("muted", "│ $")} ${truncate(active.command, 120)}`);
		const output = active.outputTail.trimEnd();
		if (output) {
			for (const line of output.split("\n").slice(-6)) {
				lines.push(`${theme.fg("muted", "│")} ${theme.fg("dim", truncate(line, 160))}`);
			}
		} else {
			lines.push(`${theme.fg("muted", "│")} ${theme.fg("dim", "(no output yet)")}`);
		}
		lines.push(`${theme.fg("muted", "│")} ${theme.fg("dim", `session ${active.id} · updated ${ageLabel(active.updatedAt)} ago`)}`);
	}

	lines.push(`${theme.fg("muted", "╰─")} ${theme.fg("dim", "alt+q/e select · alt+w fold/open · alt+r close · /codex ps")}`);
	ctx.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, lines, { placement: "aboveEditor" });
}

export function registerBackgroundBashWidgetShortcuts(
	pi: ExtensionAPI,
	state: BackgroundBashWidgetState,
	sessions: ExecSessionManager,
	config: Pick<CodexConversionConfig, "backgroundShellCloseShortcut" | "backgroundShellNextShortcut" | "backgroundShellPrevShortcut" | "backgroundShellToggleShortcut">,
	isEnabled: () => boolean,
): void {
	function rerender(ctx: ExtensionContext): void {
		if (!isEnabled()) return;
		state.ctx = ctx;
		renderBackgroundBashWidget(ctx, state, sessions);
	}

	pi.registerShortcut(config.backgroundShellToggleShortcut as "alt+w", {
		description: "Fold or open Codex background shell widget",
		handler: async (ctx) => {
			if (!isEnabled()) return;
			state.folded = !state.folded;
			rerender(ctx);
		},
	});
	pi.registerShortcut(config.backgroundShellPrevShortcut as "alt+q", {
		description: "Previous Codex background shell",
		handler: async (ctx) => {
			if (!isEnabled()) return;
			const snapshots = sessions.listSessions();
			const count = snapshots.length;
			if (count > 0) {
				const activeIndex = Math.max(0, snapshots.findIndex((session) => session.id === state.activeSessionId));
				state.activeSessionId = snapshots[(activeIndex + count - 1) % count]!.id;
			}
			rerender(ctx);
		},
	});
	pi.registerShortcut(config.backgroundShellNextShortcut as "alt+e", {
		description: "Next Codex background shell",
		handler: async (ctx) => {
			if (!isEnabled()) return;
			const snapshots = sessions.listSessions();
			const count = snapshots.length;
			if (count > 0) {
				const activeIndex = Math.max(0, snapshots.findIndex((session) => session.id === state.activeSessionId));
				state.activeSessionId = snapshots[(activeIndex + 1) % count]!.id;
			}
			rerender(ctx);
		},
	});
	pi.registerShortcut(config.backgroundShellCloseShortcut as "alt+r", {
		description: "Close active Codex background shell",
		handler: async (ctx) => {
			if (!isEnabled()) return;
			const snapshots = sessions.listSessions();
			const snapshot = snapshots.find((session) => session.id === state.activeSessionId) ?? snapshots[0];
			if (snapshot) sessions.terminateSession(snapshot.id);
			rerender(ctx);
		},
	});
}

