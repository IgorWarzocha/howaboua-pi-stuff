export const NOTEBOOK_EXEC_ACTIONS = ["status", "list", "diagnostics"] as const;

export function canExecuteNotebookControlInsideExec(request: { action: string; query?: string | undefined }): boolean {
	return NOTEBOOK_EXEC_ACTIONS.includes(request.action as typeof NOTEBOOK_EXEC_ACTIONS[number])
		&& (request.action !== "status" || request.query === undefined);
}

export function notebookExecStartupNotice(): string {
	return `Inside exec tools.notebook supports ${NOTEBOOK_EXEC_ACTIONS.join(", ")}; all others use the top-level notebook tool after exec returns`;
}
