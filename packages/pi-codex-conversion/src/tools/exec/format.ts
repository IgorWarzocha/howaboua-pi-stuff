import type { UnifiedExecResult } from "./session-manager.ts";

export const SHELL_COMPLETION_GUIDANCE =
	"Shell completion is reported automatically after the current tool batch, or wakes an idle session. Continue independent work or end the turn and resume on the report. Do not poll or block just for exit or status, including with empty write_stdin, ps, sleep or log reads.";

export function formatRunningShellGuidance(
	sessionId: number,
	nested = false,
): string {
	return `Session ${sessionId} running. ${SHELL_COMPLETION_GUIDANCE} For input or output needed before exit: ${nested ? "tools.write_stdin, not wait" : "write_stdin"}.`;
}

export function formatUnifiedExecResult(result: UnifiedExecResult): string {
	const sections: string[] = [];

	if (result.exit_code !== undefined) {
		sections.push(`Exit code: ${result.exit_code}`);
	}
	if (result.session_id !== undefined) {
		sections.push(formatRunningShellGuidance(result.session_id));
	}
	if (result.truncated) {
		sections.push(
			`[Output truncated${result.original_token_count === undefined ? "" : `; original token count: ${result.original_token_count}`}]`,
		);
	}

	sections.push("Output:");
	sections.push(result.output);

	return sections.join("\n");
}
