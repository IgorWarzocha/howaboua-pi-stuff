export const CHECKPOINT_SCHEMA = 1;

export interface CheckpointEntry {
	name: string;
	offset: number;
	length: number;
}

export interface CheckpointManifest {
	schema: number;
	project: string;
	session: string;
	deno: string;
	v8: string;
	payload: string;
	createdAt: string;
	entries: CheckpointEntry[];
	skipped: Array<{ name: string; reason: string }>;
}

export interface NotebookCheckpointIdentity {
	project: string;
	session: string;
	agentDir: string;
}
