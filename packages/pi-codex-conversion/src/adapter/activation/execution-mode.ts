import {
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readProjectCodexConversionDocument } from "./config-store.ts";

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
	return normalizeExecutionMode(
		readProjectCodexConversionDocument(ctx.cwd, ctx.isProjectTrusted())?.["executionMode"],
	);
}
