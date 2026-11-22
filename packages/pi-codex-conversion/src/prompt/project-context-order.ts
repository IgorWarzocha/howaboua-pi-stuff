import type { SystemMessage } from "@earendil-works/pi-ai";

/** Keep workspace-specific context after the harness without changing any section text. */
export function orderProjectContextLast(message: SystemMessage): SystemMessage {
	if (!message.sections) return message;
	const { project_context, cwd, ...harness } = message.sections;
	if (project_context === undefined && cwd === undefined) return message;
	return {
		...message,
		sections: {
			...harness,
			...(project_context !== undefined ? { project_context } : {}),
			...(cwd !== undefined ? { cwd } : {}),
		},
	};
}
