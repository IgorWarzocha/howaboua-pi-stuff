import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CODEX_CONVERSION_CONFIG_BASENAME } from "./config-store.ts";

export const EXECUTION_MODE_SESSION_ENTRY = "pi-codex-conversion-execution-mode";

export type ExecutionMode = "normal" | "code" | "notebook";
export type SessionExecutionMode = "inherited" | ExecutionMode;

export interface ResolvedExecutionMode {
	effective?: ExecutionMode | undefined;
	session: SessionExecutionMode;
	project?: ExecutionMode | undefined;
}

export function normalizeExecutionMode(value: unknown): ExecutionMode | undefined {
	return value === "normal" || value === "code" || value === "notebook"
		? value
		: undefined;
}

export function normalizeSessionExecutionMode(value: unknown): SessionExecutionMode | undefined {
	return value === "inherited" ? value : normalizeExecutionMode(value);
}

export function resolveExecutionMode(ctx: ExtensionContext): ResolvedExecutionMode {
	const session = readSessionExecutionMode(ctx);
	const project = readProjectExecutionMode(ctx);
	return {
		session,
		...(project ? { project } : {}),
		...(session !== "inherited"
			? { effective: session }
			: project
				? { effective: project }
				: {}),
	};
}

export function appendSessionExecutionMode(
	pi: ExtensionAPI,
	mode: SessionExecutionMode,
): void {
	pi.appendEntry(EXECUTION_MODE_SESSION_ENTRY, { mode });
}

function readSessionExecutionMode(ctx: ExtensionContext): SessionExecutionMode {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (
			entry?.type !== "custom"
			|| entry.customType !== EXECUTION_MODE_SESSION_ENTRY
			|| !entry.data
			|| typeof entry.data !== "object"
			|| !("mode" in entry.data)
		) continue;
		const mode = normalizeSessionExecutionMode(entry.data.mode);
		if (mode) return mode;
	}
	return "inherited";
}

function readProjectExecutionMode(ctx: ExtensionContext): ExecutionMode | undefined {
	if (!ctx.isProjectTrusted()) return undefined;
	const path = join(ctx.cwd, CONFIG_DIR_NAME, CODEX_CONVERSION_CONFIG_BASENAME);
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		return normalizeExecutionMode((value as Record<string, unknown>)["executionMode"]);
	} catch (error) {
		console.warn(
			`[pi-codex-conversion] Failed to read trusted project execution mode from ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}
