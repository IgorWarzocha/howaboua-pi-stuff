import type { ProjectBindingMetadata } from "./project-state-format.ts";

export const CHECKPOINT_SCHEMA = 1;

export interface CheckpointEntry extends ProjectBindingMetadata {
	name: string;
	kind: "value" | "function";
	offset: number;
	length: number;
}

export interface CheckpointManifest {
	schema: number;
	project: string;
	projectGeneration?: string | undefined;
	projectNames?: string[] | undefined;
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
