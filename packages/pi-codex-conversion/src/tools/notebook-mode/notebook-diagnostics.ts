import { pathToFileURL } from "node:url";
import type { NotebookControlResult } from "../code-mode/types.ts";
import { readNotebookJournalCodeCells } from "./journal.ts";
import { OneShotLspProcess } from "./lsp-process.ts";
import type { NotebookRuntimeHealthState } from "./runtime-health.ts";

const DIAGNOSTIC_TIMEOUT_MS = 30_000;
const MESSAGE_BUDGET = 16 * 1024;
const DETAILS_BUDGET = 16 * 1024;
const MAX_DIAGNOSTIC_TEXT_BYTES = 2 * 1024;
const MAX_DIAGNOSTIC_SAMPLES = 3;
const HOST_BINDINGS = new Set([
	"ALL_TOOLS",
	"exit",
	"generatedImage",
	"image",
	"load",
	"notify",
	"store",
	"text",
	"tools",
	"yield_control",
]);

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

export interface NotebookDiagnosticGroup {
	count: number;
	severity: NotebookDiagnostic["severity"];
	code?: string | number | undefined;
	source?: string | undefined;
	name?: string | undefined;
	message: string;
	samples: Array<Pick<NotebookDiagnostic, "cellId" | "cellIndex" | "line" | "column" | "endLine" | "endColumn">>;
}

export async function diagnoseNotebook(options: {
	deno: string;
	cwd: string;
	path: string;
	runtimeBindings?: ReadonlySet<string> | undefined;
	runtimeHealth?: NotebookRuntimeHealthState | undefined;
	signal?: AbortSignal | undefined;
}): Promise<NotebookControlResult> {
	const runtimeHealth = options.runtimeHealth ?? "not_started";
	const healthMessage = formatRuntimeHealth(runtimeHealth);
	const path = boundText(options.path);
	let cells;
	try {
		cells = readNotebookJournalCodeCells(options.path);
	} catch (error) {
		const reason = boundText(error instanceof Error ? error.message : String(error));
		return boundedDiagnosticResult(
			`${healthMessage}\nNotebook diagnostics could not read ${path}: ${reason}`,
			{ path, runtime: { state: runtimeHealth }, error: reason },
		);
	}
	if (cells.length === 0) {
		return boundedDiagnosticResult(
			`${healthMessage}\nNo historical static code cells to diagnose in ${path}`,
			{ path, cells: 0, runtime: { state: runtimeHealth }, diagnosticGroups: [] },
		);
	}

	const timeout = AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	signal.throwIfAborted();
	const lsp = new OneShotLspProcess({ deno: options.deno, cwd: options.cwd, signal });
	try {
		const rootUri = directoryUri(options.cwd);
		await lsp.request("initialize", {
			processId: process.pid,
			clientInfo: { name: "pi-notebook-diagnostics" },
			rootUri,
			workspaceFolders: [{ uri: rootUri, name: options.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace" }],
			capabilities: {
				workspace: { configuration: false, workspaceFolders: false },
				textDocument: { diagnostic: {}, publishDiagnostics: { relatedInformation: true } },
				notebookDocument: { synchronization: { dynamicRegistration: false, executionSummarySupport: false } },
			},
			initializationOptions: { enable: true },
		});
		lsp.notify("initialized", {});

		const notebookUri = pathToFileURL(options.path).href;
		const documents = cells.map((cell) => ({
			cell,
			uri: notebookCellUri(options.path, cell.index, cell.id),
		}));
		lsp.notify("notebookDocument/didOpen", {
			notebookDocument: {
				uri: notebookUri,
				notebookType: "jupyter-notebook",
				version: 1,
				cells: documents.map(({ uri }) => ({ kind: 2, document: uri })),
			},
			cellTextDocuments: documents.map(({ cell, uri }) => ({
				uri,
				languageId: "typescript",
				version: 1,
				text: cell.source,
			})),
		});
		const reports: unknown[] = [];
		for (const { uri } of documents) {
			reports.push(await lsp.request("textDocument/diagnostic", { textDocument: { uri } }));
		}
		const runtimeBindings = new Set([...HOST_BINDINGS, ...(options.runtimeBindings ?? [])]);
		const diagnostics = reports.flatMap((report, index) => parseDiagnosticReport(report, documents[index]!.cell, runtimeBindings));
		lsp.notify("notebookDocument/didClose", {
			notebookDocument: { uri: notebookUri },
			cellTextDocuments: documents.map(({ uri }) => ({ uri })),
		});
		return formatNotebookDiagnostics(options.path, cells.length, diagnostics, runtimeHealth);
	} catch (error) {
		if (options.signal?.aborted) throw error;
		const reason = boundText(timeout.aborted
			? `Deno diagnostics timed out after ${DIAGNOSTIC_TIMEOUT_MS}ms`
			: error instanceof Error ? error.message : String(error));
		return boundedDiagnosticResult(
			`${healthMessage}\nNotebook diagnostics could not complete: ${reason}`,
			{ path, cells: cells.length, runtime: { state: runtimeHealth }, error: reason },
		);
	} finally {
		await lsp.shutdown();
	}
}

function parseDiagnosticReport(
	value: unknown,
	cell: { id: string; index: number; source: string },
	runtimeBindings: ReadonlySet<string>,
): NotebookDiagnostic[] {
	if (!isRecord(value) || !Array.isArray(value["items"])) return [];
	return value["items"].flatMap((item) => {
		if (!isRecord(item) || typeof item["message"] !== "string" || !isRange(item["range"])) return [];
		const range = item["range"];
		if (isRuntimeDiagnostic(item, range, cell.source, runtimeBindings)) return [];
		const message = boundText(item["message"]);
		return [{
			cellId: cell.id,
			cellIndex: cell.index,
			line: range.start.line + 1,
			column: range.start.character + 1,
			endLine: range.end.line + 1,
			endColumn: range.end.character + 1,
			severity: severityName(item["severity"]),
			...(typeof item["code"] === "string" || typeof item["code"] === "number" ? { code: item["code"] } : {}),
			...(typeof item["source"] === "string" ? { source: item["source"] } : {}),
			...(diagnosticName(message) ? { name: diagnosticName(message) } : {}),
			message,
		}];
	});
}

function isRuntimeDiagnostic(
	diagnostic: Record<string, unknown>,
	range: { start: { line: number; character: number }; end: { line: number; character: number } },
	source: string,
	runtimeBindings: ReadonlySet<string>,
): boolean {
	if (diagnostic["code"] === 2304 && typeof diagnostic["message"] === "string") {
		const name = /^Cannot find name '([^']+)'/.exec(diagnostic["message"])?.[1];
		if (name && runtimeBindings.has(name)) return true;
	}
	if (diagnostic["code"] !== 7017) return false;
	const line = source.split("\n")[range.start.line];
	return line !== undefined && /globalThis\s*\.\s*$/.test(line.slice(0, range.start.character));
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

function formatRuntimeHealth(state: NotebookRuntimeHealthState): string {
	switch (state) {
		case "ready": return "Notebook runtime health: ready; bootstrap is available";
		case "invalidated": return "Notebook runtime health: invalidated; exec or restart will recreate it from the last completed checkpoint. Durable project bindings are preserved; external side effects were not rolled back";
		case "not_started": return "Notebook runtime health: not started; exec or restart will create it from the last completed checkpoint";
	}
}

function diagnosticName(message: string): string | undefined {
	return /(?:Cannot redeclare block-scoped variable|Duplicate identifier) ['"]([^'"]+)['"]/.exec(message)?.[1];
}

function boundText(value: string): string {
	return boundUtf8(value, MAX_DIAGNOSTIC_TEXT_BYTES, " [diagnostic text truncated]");
}

function boundedDiagnosticResult(message: string, details: Record<string, unknown>): NotebookControlResult {
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

function notebookCellUri(path: string, index: number, id: string): string {
	return `deno-notebook-cell:${pathToFileURL(path).pathname}#${index + 1}-${encodeURIComponent(id)}`;
}

function directoryUri(path: string): string {
	const uri = pathToFileURL(path).href;
	return uri.endsWith("/") ? uri : `${uri}/`;
}

function severityName(value: unknown): NotebookDiagnostic["severity"] {
	if (value === 1) return "error";
	if (value === 2) return "warning";
	if (value === 3) return "information";
	if (value === 4) return "hint";
	return "unknown";
}

function isRange(value: unknown): value is { start: { line: number; character: number }; end: { line: number; character: number } } {
	return isRecord(value)
		&& isPosition(value["start"])
		&& isPosition(value["end"]);
}

function isPosition(value: unknown): value is { line: number; character: number } {
	return isRecord(value)
		&& Number.isSafeInteger(value["line"])
		&& (value["line"] as number) >= 0
		&& Number.isSafeInteger(value["character"])
		&& (value["character"] as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
