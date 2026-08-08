import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { KernelExecutionResult } from "./jupyter-kernel.ts";
import type { RuntimeContentItem } from "../code-mode/types.ts";

const NOTEBOOK_FORMAT = 4;
const NOTEBOOK_MINOR = 5;
const MAX_CELL_OUTPUT_CHARS = 16 * 1024 * 1024;

interface NotebookDocument {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat: number;
	nbformat_minor: number;
}

interface NotebookCell {
	cell_type: string;
	execution_count?: number | null | undefined;
	metadata: Record<string, unknown>;
	outputs?: Array<Record<string, unknown>> | undefined;
	source: string[] | string;
}

export interface NotebookJournal {
	path: string;
	project: string;
	session: string;
	cells: number;
	completedCells: number;
}

export interface NotebookJournalCodeCell {
	id: string;
	index: number;
	source: string;
}

export function initializeNotebookJournal(identity: { project: string; session: string; agentDir: string }): NotebookJournal {
	const project = resolve(identity.project);
	const projectKey = createHash("sha256").update(project).digest("hex");
	const sessionKey = createHash("sha256").update(identity.session).digest("hex");
	const directory = join(
		identity.agentDir,
		"cache",
		"pi-codex-conversion",
		"notebook-mode",
		"journals",
		projectKey,
	);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${sessionKey}.ipynb`);
	const existing = readJournal(path);
	const journal = {
		path,
		project,
		session: identity.session,
		cells: existing?.cells.length ?? 0,
		completedCells: existing?.cells.filter((cell) => notebookCellStatus(cell) !== "running").length ?? 0,
	};
	if (!existsSync(journal.path)) writeJournal(journal.path, emptyDocument(journal));
	return journal;
}

export function beginNotebookJournalCell(
	journal: NotebookJournal,
	cell: { id: string; source: string },
): void {
	const document = readJournal(journal.path);
	if (!document) throw new Error(`Notebook journal is invalid: ${journal.path}`);
	const executionCount = document.cells.length + 1;
	document.cells.push({
		cell_type: "code",
		execution_count: executionCount,
		metadata: {
			pi: {
				cellId: cell.id,
				status: "running",
				createdAt: new Date().toISOString(),
			},
		},
		outputs: [],
		source: sourceLines(cell.source),
	});
	writeJournal(journal.path, document);
	journal.cells = executionCount;
}

export function finishNotebookJournalCell(
	journal: NotebookJournal,
	cell: { id: string; source: string; items: RuntimeContentItem[]; result: KernelExecutionResult },
): void {
	const document = readJournal(journal.path);
	if (!document) throw new Error(`Notebook journal is invalid: ${journal.path}`);
	const existing = document.cells.find((entry) => notebookCellId(entry) === cell.id);
	if (existing) {
		const wasRunning = notebookCellStatus(existing) === "running";
		const pi = isRecord(existing.metadata["pi"]) ? existing.metadata["pi"] : {};
		existing.metadata["pi"] = { ...pi, cellId: cell.id, status: cell.result.status, completedAt: new Date().toISOString() };
		existing.outputs = journalOutputs(cell.items, cell.result);
		if (wasRunning) journal.completedCells += 1;
	} else {
		document.cells.push({
			cell_type: "code",
			execution_count: document.cells.length + 1,
			metadata: {
				pi: {
					cellId: cell.id,
					status: cell.result.status,
					createdAt: new Date().toISOString(),
					completedAt: new Date().toISOString(),
				},
			},
			outputs: journalOutputs(cell.items, cell.result),
			source: sourceLines(cell.source),
		});
		journal.completedCells += 1;
	}
	writeJournal(journal.path, document);
	journal.cells = document.cells.length;
}

export function readNotebookJournalCodeCells(path: string): NotebookJournalCodeCell[] {
	const document = readJournal(path);
	if (!document) throw new Error(`Notebook journal is invalid: ${path}`);
	return document.cells.flatMap((cell, index) => {
		if (cell.cell_type !== "code") return [];
		if (typeof cell.source !== "string" && !cell.source.every((line) => typeof line === "string")) {
			throw new Error(`Notebook code cell ${index + 1} has invalid source: ${path}`);
		}
		return [{
			id: notebookCellId(cell) ?? `cell-${index + 1}`,
			index,
			source: Array.isArray(cell.source) ? cell.source.join("") : cell.source,
		}];
	});
}

function journalOutputs(items: RuntimeContentItem[], result: KernelExecutionResult): Array<Record<string, unknown>> {
	const outputs: Array<Record<string, unknown>> = [];
	let remaining = MAX_CELL_OUTPUT_CHARS;
	for (const item of items) {
		if (remaining <= 0) break;
		if (item.type === "input_text" && item.text) {
			const text = item.text.slice(0, remaining);
			remaining -= text.length;
			outputs.push({ name: "stdout", output_type: "stream", text: sourceLines(text) });
			continue;
		}
		const match = item.type === "input_image" && item.image_url?.match(/^data:([^;,]+);base64,(.+)$/s);
		if (!match) continue;
		if (match[2]!.length > remaining) {
			remaining = 0;
			continue;
		}
		const data = match[2]!;
		remaining -= data.length;
		outputs.push({ output_type: "display_data", data: { [match[1]!]: data }, metadata: {} });
	}
	if (remaining <= 0) outputs.push({ name: "stderr", output_type: "stream", text: ["[notebook journal output truncated]\n"] });
	if (result.status === "error" && result.errorText) {
		const marker = "\n[notebook journal error truncated]";
		const errorBudget = Math.floor(Math.max(0, remaining) / 2);
		const errorText = result.errorText.length > errorBudget
			? `${result.errorText.slice(0, Math.max(0, errorBudget - marker.length))}${marker.slice(0, errorBudget)}`
			: result.errorText;
		outputs.push({
			output_type: "error",
			ename: "NotebookCellError",
			evalue: errorText,
			traceback: errorText.split("\n"),
		});
	}
	return outputs;
}

function emptyDocument(journal: NotebookJournal): NotebookDocument {
	return {
		cells: [],
		metadata: {
			kernelspec: { display_name: "Deno", language: "typescript", name: "deno" },
			language_info: { name: "typescript" },
			pi: { project: journal.project, session: journal.session, createdAt: new Date().toISOString() },
		},
		nbformat: NOTEBOOK_FORMAT,
		nbformat_minor: NOTEBOOK_MINOR,
	};
}

function readJournal(path: string): NotebookDocument | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || !Array.isArray(value["cells"]) || !isRecord(value["metadata"])) return undefined;
		if (value["nbformat"] !== NOTEBOOK_FORMAT || value["nbformat_minor"] !== NOTEBOOK_MINOR) return undefined;
		const cells = value["cells"].map((cell) => {
			if (!isRecord(cell) || typeof cell["cell_type"] !== "string" || !isRecord(cell["metadata"])) return undefined;
			if (typeof cell["source"] !== "string" && !Array.isArray(cell["source"])) return undefined;
			return cell as unknown as NotebookCell;
		});
		if (cells.some((cell) => !cell)) return undefined;
		return {
			cells: cells as NotebookCell[],
			metadata: value["metadata"],
			nbformat: NOTEBOOK_FORMAT,
			nbformat_minor: NOTEBOOK_MINOR,
		};
	} catch {
		return undefined;
	}
}

function writeJournal(path: string, document: NotebookDocument): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function sourceLines(source: string): string[] {
	const lines = source.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
	return lines.length > 0 ? lines : [""];
}

function notebookCellId(cell: NotebookCell): string | undefined {
	const pi = cell.metadata["pi"];
	return isRecord(pi) && typeof pi["cellId"] === "string" ? pi["cellId"] : undefined;
}

function notebookCellStatus(cell: NotebookCell): string | undefined {
	const pi = cell.metadata["pi"];
	return isRecord(pi) && typeof pi["status"] === "string" ? pi["status"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
