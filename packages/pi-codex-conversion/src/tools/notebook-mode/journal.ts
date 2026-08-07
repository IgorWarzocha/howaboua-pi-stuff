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
	cell_type: "code";
	execution_count: number;
	metadata: Record<string, unknown>;
	outputs: Array<Record<string, unknown>>;
	source: string[];
}

export interface NotebookJournal {
	path: string;
	project: string;
	session: string;
	cells: number;
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
	};
	if (!existsSync(journal.path)) writeJournal(journal.path, emptyDocument(journal));
	return journal;
}

export function appendNotebookJournalCell(
	journal: NotebookJournal,
	cell: { id: string; source: string; items: RuntimeContentItem[]; result: KernelExecutionResult },
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
				status: cell.result.status,
				createdAt: new Date().toISOString(),
			},
		},
		outputs: journalOutputs(cell.items, cell.result),
		source: sourceLines(cell.source),
	});
	writeJournal(journal.path, document);
	journal.cells = executionCount;
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
		return value as unknown as NotebookDocument;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
