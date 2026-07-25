export type ShellAction =
	| { kind: "read"; command: string; name: string; path: string }
	| { kind: "list"; command: string; path?: string | undefined }
	| { kind: "search"; command: string; query?: string | undefined; path?: string | undefined }
	| { kind: "run"; command: string };

export interface CommandSummary {
	maskAsExplored: boolean;
	actions: ShellAction[];
}
