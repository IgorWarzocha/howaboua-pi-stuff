export const NOTEBOOK_EXEC_ACTIONS = ["status", "list", "diagnostics"] as const;

export function canExecuteNotebookControlInsideExec(request: { action: string; query?: string | undefined }): boolean {
	return NOTEBOOK_EXEC_ACTIONS.includes(request.action as typeof NOTEBOOK_EXEC_ACTIONS[number])
		&& (request.action !== "status" || request.query === undefined);
}

export function notebookExecStartupNotice(): string {
	return 'Inside exec: tools.notebook({action:"status"}); also "list" or "diagnostics"; direct object, not {input:...}; status without query. Other controls: top-level notebook after exec returns';
}
