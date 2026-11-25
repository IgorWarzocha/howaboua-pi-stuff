import type { UnifiedExecResult } from "./session-manager.ts";

export function formatRunningShellGuidance(
	sessionId: number,
	nested = false,
): string {
	return `Session ${sessionId} still running. Completion reports automatically when idle; continue work or end turn. Use ${nested ? "tools." : ""}write_stdin for input or intermediate output${nested ? "; do not use wait" : ""}`;
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
