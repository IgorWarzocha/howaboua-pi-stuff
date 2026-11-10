import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerContextWindowPreparation } from "../compaction.ts";
import { CODEX_CONTEXT_BRIEFING_TYPE, type CodexContextBriefing } from "../context-briefings.ts";
import { admitCustomTurn } from "../custom-turn-admission.ts";
import { withCodexDeveloperMessageDetails } from "../developer-messages.ts";
import type { ExecSessionManager } from "../tools/exec/session-manager.ts";

export interface CodexShellLifecycle {
	recordBriefing(ctx: ExtensionContext, messages: readonly AgentMessage[]): boolean;
}

interface ShellContext {
	ctx: ExtensionContext;
	sessionId: string;
	paused: boolean;
	admitted: boolean;
	briefingId?: string | undefined;
}

function shortCommand(command: string): string {
	return command.length > 512 ? `${command.slice(0, 512)}…` : command;
}

export function registerCodexShellLifecycle(
	pi: ExtensionAPI,
	sessions: ExecSessionManager,
	enabled: () => boolean,
): CodexShellLifecycle {
	let active: ShellContext | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let preparing = false;
	let disposed = false;

	function activate(ctx: ExtensionContext): ShellContext {
		const sessionId = ctx.sessionManager.getSessionId();
		if (!active || active.sessionId !== sessionId)
			active = { ctx, sessionId, paused: false, admitted: false };
		else active.ctx = ctx;
		return active;
	}

	function idle(owner: ShellContext): boolean {
		return !disposed && enabled() && active === owner && !owner.paused
			&& owner.ctx.sessionManager.getSessionId() === owner.sessionId && owner.ctx.isIdle();
	}

	function hasCompletions(owner: ShellContext): boolean {
		return sessions.backgroundSessions(owner.sessionId).some(session => !session.running && !session.completionNotified);
	}

	async function wake(): Promise<void> {
		const owner = active;
		if (!owner || preparing || !idle(owner) || !hasCompletions(owner)) return;
		preparing = true;
		try {
			// Notes may roll over here. Never reserve Pi's kickoff before that preparation.
			const preparation = admitCustomTurn(pi, owner.ctx);
			if (preparation) await preparation;
			// A user turn or normal result collection can win while admission is awaited.
			if (!idle(owner) || !hasCompletions(owner)) return;
			const completions = sessions.collectCompletions(owner.sessionId);
			const results = completions.map(({ id, command, result }) => ({
				session_id: id,
				command: shortCommand(command),
				exit_code: result.exit_code,
				output: result.output,
				...(result.truncated ? { truncated: true, more: `write_stdin session_id=${id}` } : {}),
			}));
			pi.sendMessage(withCodexDeveloperMessageDetails({
				customType: "codex-shell-completion",
				content: `Background shell completion:\n${JSON.stringify(results)}`,
				display: true,
				details: {},
			}), { triggerTurn: true });
		} catch {
			if (active === owner && !disposed)
				owner.ctx.ui.notify("Background shell results could not start a turn. Collect them with write_stdin; if rollover failed, retry it first.", "error");
		} finally {
			preparing = false;
		}
	}

	function schedule(): void {
		if (timer || preparing || !active || !idle(active) || !hasCompletions(active)) return;
		// agent_settled still owns Pi's settlement frame; start only after it unwinds.
		timer = setTimeout(() => {
			timer = undefined;
			void wake();
		}, 0);
		timer.unref?.();
	}

	function invalidate(): void {
		if (!active) return;
		active.admitted = false;
		active.briefingId = undefined;
	}

	const removeExit = sessions.onSessionExit(schedule);
	const removePreparation = registerContextWindowPreparation(pi, invalidate);
	pi.on("session_start", (_event, ctx) => {
		activate(ctx).paused = false;
		invalidate();
		schedule();
	});
	pi.on("session_tree", (_event, ctx) => {
		activate(ctx);
		invalidate();
	});
	pi.on("session_compact", invalidate);
	pi.on("agent_start", (_event, ctx) => { activate(ctx).paused = false; });
	pi.on("agent_settled", (event, ctx) => {
		activate(ctx).paused = event.aborted;
		schedule();
	});
	pi.on("session_shutdown", () => {
		disposed = true;
		if (timer) clearTimeout(timer);
		timer = undefined;
		removeExit();
		removePreparation();
		active = undefined;
	});

	return {
		recordBriefing(ctx, messages) {
			if (disposed || !enabled()) return false;
			const owner = activate(ctx);
			if (owner.admitted && (!owner.briefingId || messages.some(message => message.role === "custom"
				&& message.customType === CODEX_CONTEXT_BRIEFING_TYPE && message.details
				&& typeof message.details === "object" && "id" in message.details && message.details.id === owner.briefingId))) return false;
			owner.admitted = true;
			const pending = sessions.backgroundSessions(owner.sessionId);
			if (!pending.length) return false;
			const id = randomUUID();
			const lines = pending.map(session => `- ${session.id}: ${session.running ? "running" : `exit ${session.exitCode}, uncollected`} ${JSON.stringify(shortCommand(session.command))}`);
			pi.appendEntry<CodexContextBriefing>(CODEX_CONTEXT_BRIEFING_TYPE, {
				protocol: 1,
				id,
				owner: "shells",
				key: owner.sessionId,
				content: `Background shells in this Pi session:\n${lines.join("\n")}\nCollect results with write_stdin. Keep normal monitoring; idle completion notices are a safety net.`,
			});
			owner.briefingId = id;
			return true;
		},
	};
}
