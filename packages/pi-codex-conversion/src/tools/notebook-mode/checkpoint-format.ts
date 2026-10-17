import type { ProjectBindingMetadata } from "./project-state-format.ts";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

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

export function checkpointPaths(identity: NotebookCheckpointIdentity): { directory: string; manifest: string } {
	const key = createHash("sha256").update(`${resolve(identity.project)}\0${identity.session}`).digest("hex");
	const directory = join(identity.agentDir, "cache", "pi-codex-conversion", "notebook-mode", "sessions", key);
	return { directory, manifest: join(directory, "checkpoint.json") };
}
