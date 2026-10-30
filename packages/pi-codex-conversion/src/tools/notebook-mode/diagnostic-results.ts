import type { NotebookControlResult } from "../code-mode/types.ts";
import type { NotebookRuntimeHealthState } from "./runtime-health.ts";

const MESSAGE_BUDGET = 16 * 1024;
const DETAILS_BUDGET = 16 * 1024;
const MAX_DIAGNOSTIC_TEXT_BYTES = 2 * 1024;
const MAX_DIAGNOSTIC_SAMPLES = 3;
export interface NotebookDiagnostic {
	cellId: string;
	cellIndex: number;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	severity: "error" | "warning" | "information" | "hint" | "unknown";
	code?: string | number | undefined;
	source?: string | undefined;
	name?: string | undefined;
	message: string;
}

interface NotebookDiagnosticGroup {
	count: number;
	severity: NotebookDiagnostic["severity"];
	code?: string | number | undefined;
	source?: string | undefined;
	name?: string | undefined;
	message: string;
	samples: Array<Pick<NotebookDiagnostic, "cellId" | "cellIndex" | "line" | "column" | "endLine" | "endColumn">>;
}

export function formatNotebookDiagnostics(path: string, cells: number, diagnostics: NotebookDiagnostic[], runtimeHealth: NotebookRuntimeHealthState = "not_started"): NotebookControlResult {
	const groups = groupDiagnostics(diagnostics);
	const reportedPath = boundText(path);
	const lines = [formatRuntimeHealth(runtimeHealth), `Historical static diagnostics for ${reportedPath} (${cells} code cells):`];
	const included: NotebookDiagnosticGroup[] = [];
	for (const group of groups) {
		const line = formatDiagnosticGroup(group);
		const candidate = [...included, group];
		const candidateDetails = diagnosticDetails(reportedPath, cells, runtimeHealth, diagnostics.length, candidate, groups.length - candidate.length);
		if (Buffer.byteLength(JSON.stringify(candidateDetails), "utf8") > DETAILS_BUDGET) break;
		if (Buffer.byteLength(`${lines.join("\n")}\n${line}`, "utf8") + 64 > MESSAGE_BUDGET) break;
		lines.push(line);
		included.push(group);
	}
	const omittedGroups = groups.length - included.length;
	if (groups.length === 0) lines.push("No historical static Deno diagnostics");
	if (omittedGroups > 0) lines.push(`${omittedGroups} additional historical diagnostic group${omittedGroups === 1 ? "" : "s"} omitted by the output bound`);
	return boundedDiagnosticResult(
		lines.join("\n"),
		diagnosticDetails(reportedPath, cells, runtimeHealth, diagnostics.length, included, omittedGroups),
	);
}

function diagnosticDetails(
	path: string,
	cells: number,
	runtimeHealth: NotebookRuntimeHealthState,
	diagnosticCount: number,
	diagnosticGroups: NotebookDiagnosticGroup[],
	omittedGroups: number,
): Record<string, unknown> {
	return { path, cells, runtime: { state: runtimeHealth }, diagnosticCount, diagnosticGroups, omittedGroups };
}

function groupDiagnostics(diagnostics: NotebookDiagnostic[]): NotebookDiagnosticGroup[] {
	const groups = new Map<string, NotebookDiagnosticGroup>();
	for (const diagnostic of diagnostics) {
		const key = JSON.stringify([
			diagnostic.code ?? null,
			diagnostic.message,
			diagnostic.name ?? null,
			diagnostic.severity,
			diagnostic.source ?? null,
		]);
		let group = groups.get(key);
		if (!group) {
			group = {
				count: 0,
				severity: diagnostic.severity,
				...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
				...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
				...(diagnostic.name === undefined ? {} : { name: diagnostic.name }),
				message: diagnostic.message,
				samples: [],
			};
			groups.set(key, group);
		}
		group.count += 1;
		if (group.samples.length < MAX_DIAGNOSTIC_SAMPLES) group.samples.push({
			cellId: diagnostic.cellId,
			cellIndex: diagnostic.cellIndex,
			line: diagnostic.line,
			column: diagnostic.column,
			endLine: diagnostic.endLine,
			endColumn: diagnostic.endColumn,
		});
	}
	return [...groups.values()];
}

function formatDiagnosticGroup(group: NotebookDiagnosticGroup): string {
	const code = group.code === undefined ? "" : ` ${group.source ?? "deno"}-${group.code}`;
	const name = group.name ? ` [${group.name}]` : "";
	const samples = group.samples.map((sample) => `${sample.cellId} cell ${sample.cellIndex + 1}:${sample.line}:${sample.column}`).join(", ");
	return `- ${group.count} occurrence${group.count === 1 ? "" : "s"} ${group.severity}${code}${name}: ${group.message.replaceAll("\n", " ")}; samples: ${samples}`;
}

export function formatRuntimeHealth(state: NotebookRuntimeHealthState): string {
	switch (state) {
		case "ready": return "Notebook runtime health: ready; bootstrap is available";
		case "invalidated": return "Notebook runtime health: invalidated; exec or restart will recreate it from the last completed checkpoint. Durable project bindings are preserved; external side effects were not rolled back";
		case "not_started": return "Notebook runtime health: not started; exec or restart will create it from the last completed checkpoint";
	}
}

export function boundText(value: string): string {
	return boundUtf8(value, MAX_DIAGNOSTIC_TEXT_BYTES, " [diagnostic text truncated]");
}

export function boundedDiagnosticResult(message: string, details: Record<string, unknown>): NotebookControlResult {
	const boundedMessage = boundUtf8(message, MESSAGE_BUDGET, "\n[diagnostics output truncated]");
	if (Buffer.byteLength(JSON.stringify(details), "utf8") <= DETAILS_BUDGET) {
		return { message: boundedMessage, details };
	}
	return {
		message: boundedMessage,
		details: {
			...(isRecord(details["runtime"]) ? { runtime: details["runtime"] } : {}),
			detailsOmitted: true,
		},
	};
}

function boundUtf8(value: string, maxBytes: number, suffix: string): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	const available = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
	let low = 0;
	let high = value.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(value.slice(0, middle), "utf8") <= available) low = middle;
		else high = middle - 1;
	}
	let prefix = value.slice(0, low);
	const last = prefix.charCodeAt(prefix.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
	return `${prefix}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
