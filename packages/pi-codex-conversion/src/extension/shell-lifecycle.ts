import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	BoundaryState,
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerContextWindowPreparation } from "../compaction.ts";
import {
	CODEX_CONTEXT_BRIEFING_TYPE,
	type CodexContextBriefing,
} from "../context-briefings.ts";
import { admitCustomTurn } from "../custom-turn-admission.ts";
import { withCodexDeveloperMessageDetails } from "../developer-messages.ts";
import { SHELL_COMPLETION_GUIDANCE } from "../tools/exec/format.ts";
import type {
	ExecSessionCompletion,
	ExecSessionManager,
} from "../tools/exec/session-manager.ts";

const SHELL_COMPLETION_TYPE = "codex-shell-completion";

export interface CodexShellLifecycle {
	recordBriefing(
		ctx: ExtensionContext,
		messages: readonly AgentMessage[],
	): boolean;
}

interface ShellContext {
	ctx: ExtensionContext;
	sessionId: string;
	paused: boolean;
	admitted: boolean;
	briefingId?: string | undefined;
	pendingNotice?:
		| {
				id: string;
				completions: ExecSessionCompletion[];
		  }
		| undefined;
}

function shortCommand(command: string): string {
	return command.length > 512 ? `${command.slice(0, 512)}…` : command;
}

export function registerCodexShellLifecycle(
	pi: ExtensionAPI,
	sessions: ExecSessionManager,
	isActive: (ctx: ExtensionContext) => boolean,
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

	function canDeliver(owner: ShellContext): boolean {
		return (
			!disposed &&
			active === owner &&
			!owner.paused &&
			isActive(owner.ctx) &&
			owner.ctx.sessionManager.getSessionId() === owner.sessionId
		);
	}

	function idle(owner: ShellContext): boolean {
		return canDeliver(owner) && owner.ctx.isIdle();
	}

	function hasCompletions(owner: ShellContext): boolean {
		return sessions
			.backgroundSessions(owner.sessionId)
			.some((session) => !session.running && !session.completionNotified);
	}

	function acknowledgeNotice(owner: ShellContext): void {
		const pending = owner.pendingNotice;
		if (!pending) return;
		owner.pendingNotice = undefined;
		if (
			owner.ctx.sessionManager
				.getEntries()
				.some(
					(entry) =>
						entry.type === "custom_message" &&
						entry.customType === SHELL_COMPLETION_TYPE &&
						entry.details &&
						typeof entry.details === "object" &&
						"completionBatchId" in entry.details &&
						entry.details.completionBatchId === pending.id,
				)
		)
			sessions.acknowledgeCompletions(pending.completions);
	}

	function createNotice(
		owner: ShellContext,
	): CustomMessageEntryDraft | undefined {
		const completions = sessions.pendingCompletions(owner.sessionId);
		if (!completions.length) return;
		const id = randomUUID();
		const results = completions.map(({ id, command, result }) => ({
			session_id: id,
			command: shortCommand(command),
			exit_code: result.exit_code,
			output: result.output,
			...(result.truncated
				? { truncated: true, more: `write_stdin session_id=${id}` }
				: {}),
		}));
		const notice = withCodexDeveloperMessageDetails({
			type: "custom_message" as const,
			customType: SHELL_COMPLETION_TYPE,
			content: `Background shell completion:\n${JSON.stringify(results)}`,
			display: true,
			details: { completionBatchId: id },
		});
		owner.pendingNotice = { id, completions };
		return notice;
	}

	function deliverAtBoundary(event: BoundaryState, ctx: ExtensionContext) {
		const owner = activate(ctx);
		acknowledgeNotice(owner);
		if (event.outcome !== "completed" || !canDeliver(owner)) return;
		// Pi commits after the entire tool batch. No steering queue to clear, and
		// an already-planned request satisfies continue without another turn.
		const notice = createNotice(owner);
		if (notice) return { entries: [...event.entries, notice], continue: true };
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
			if (!idle(owner)) return;
			acknowledgeNotice(owner);
			const notice = createNotice(owner);
			if (notice) {
				const { customType, content, display, details } = notice;
				pi.sendMessage(
					{ customType, content, display, details },
					{
						triggerTurn: true,
					},
				);
			}
		} catch {
			if (active === owner && !disposed)
				owner.ctx.ui.notify(
					"Background shell results could not start a turn. Collect them with write_stdin; if rollover failed, retry it first.",
					"error",
				);
		} finally {
			preparing = false;
		}
	}

	function schedule(): void {
		if (
			timer ||
			preparing ||
			!active ||
			!idle(active) ||
			!hasCompletions(active)
		)
			return;
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
	pi.on("model_select", (_event, ctx) => {
		activate(ctx);
		schedule();
	});
	pi.on("session_compact", invalidate);
	pi.on("agent_start", (_event, ctx) => {
		activate(ctx).paused = false;
	});
	pi.on("turn_end", deliverAtBoundary);
	pi.on("agent_before_settle", deliverAtBoundary);
	pi.on("agent_settled", (event, ctx) => {
		const owner = activate(ctx);
		acknowledgeNotice(owner);
		owner.paused = event.aborted;
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
			if (disposed || !isActive(ctx)) return false;
			const owner = activate(ctx);
			if (
				owner.admitted &&
				(!owner.briefingId ||
					messages.some(
						(message) =>
							message.role === "custom" &&
							message.customType === CODEX_CONTEXT_BRIEFING_TYPE &&
							message.details &&
							typeof message.details === "object" &&
							"id" in message.details &&
							message.details.id === owner.briefingId,
					))
			)
				return false;
			owner.admitted = true;
			const pending = sessions.backgroundSessions(owner.sessionId);
			if (!pending.length) return false;
			const id = randomUUID();
			const lines = pending.map(
				(session) =>
					`- ${session.id}: ${session.running ? "running" : `exit ${session.exitCode}, uncollected`} ${JSON.stringify(shortCommand(session.command))}`,
			);
			pi.appendEntry<CodexContextBriefing>(CODEX_CONTEXT_BRIEFING_TYPE, {
				protocol: 1,
				id,
				owner: "shells",
				key: owner.sessionId,
				content: `Background shells in this session:\n${lines.join("\n")}\n${SHELL_COMPLETION_GUIDANCE} Use write_stdin for input or output needed now.`,
			});
			owner.briefingId = id;
			return true;
		},
	};
}
