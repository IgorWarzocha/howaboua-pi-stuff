import type { UnifiedExecResult } from "./session-manager.ts";

export function formatUnifiedExecResult(result: UnifiedExecResult, command?: string): string {
	const sections: string[] = [];

	if (command) {
		sections.push(`Command: ${command}`);
	}
	if (result.chunk_id) {
		sections.push(`Chunk ID: ${result.chunk_id}`);
	}
	sections.push(`Wall time: ${result.wall_time_seconds.toFixed(4)} seconds`);

	if (result.exit_code !== undefined) {
		sections.push(`Process exited with code ${result.exit_code}`);
	}
	if (result.session_id !== undefined) {
		sections.push(`Process running with session ID ${result.session_id}`);
	}
	if (result.original_token_count !== undefined) {
		sections.push(`Original token count: ${result.original_token_count}`);
	}

	sections.push("Output:");
	sections.push(result.output);

	return sections.join("\n");
}
