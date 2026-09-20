import type { UnifiedExecResult } from "./session-manager.ts";

export function formatUnifiedExecResult(result: UnifiedExecResult): string {
	const sections: string[] = [];

	if (result.exit_code !== undefined) {
		sections.push(`Exit code: ${result.exit_code}`);
	}
	if (result.session_id !== undefined) {
		sections.push(`Session ${result.session_id} still running. Resume near completion with write_stdin and an appropriate yield_time_ms`);
	}
	if (result.truncated) {
		sections.push(`[Output truncated${result.original_token_count === undefined ? "" : `; original token count: ${result.original_token_count}`}]`);
	}

	sections.push("Output:");
	sections.push(result.output);

	return sections.join("\n");
}
