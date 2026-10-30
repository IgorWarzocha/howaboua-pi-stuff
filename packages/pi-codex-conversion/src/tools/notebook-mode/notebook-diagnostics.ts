import { boundText, boundedDiagnosticResult, formatNotebookDiagnostics, formatRuntimeHealth, type NotebookDiagnostic } from "./diagnostic-results.ts";
import { pathToFileURL } from "node:url";
import type { NotebookControlResult } from "../code-mode/types.ts";
import { readNotebookJournalCodeCells } from "./journal.ts";
import { OneShotLspProcess } from "./lsp-process.ts";
import type { NotebookRuntimeHealthState } from "./runtime-health.ts";

const DIAGNOSTIC_TIMEOUT_MS = 30_000;
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

function diagnosticName(message: string): string | undefined {
	return /(?:Cannot redeclare block-scoped variable|Duplicate identifier) ['"]([^'"]+)['"]/.exec(message)?.[1];
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
