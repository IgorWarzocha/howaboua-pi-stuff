import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const NOTEBOOK_FORMAT = 4;
const NOTEBOOK_MINOR = 5;

export interface NotebookDocument {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat: number;
	nbformat_minor: number;
}

export interface NotebookCell {
	cell_type: string;
	execution_count?: number | null | undefined;
	metadata: Record<string, unknown>;
	outputs?: Array<Record<string, unknown>> | undefined;
	source: string[] | string;
}

export type NotebookJournalEvent =
	| { type: "begin"; id: string; source: string; createdAt: string }
	| { type: "finish"; id: string; source: string; status: string; completedAt: string; outputs: Array<Record<string, unknown>> };

export function emptyNotebookDocument(project: string, session: string): NotebookDocument {
	return {
		cells: [],
		metadata: {
			kernelspec: { display_name: "Deno", language: "typescript", name: "deno" },
			language_info: { name: "typescript" },
			pi: { project, session, createdAt: new Date().toISOString() },
		},
		nbformat: NOTEBOOK_FORMAT,
		nbformat_minor: NOTEBOOK_MINOR,
	};
}

export function applyNotebookJournalEvent(document: NotebookDocument, event: NotebookJournalEvent): void {
	const existing = document.cells.find((cell) => notebookCellId(cell) === event.id);
	if (event.type === "begin") {
		if (existing) return;
		document.cells.push({
			cell_type: "code",
			execution_count: document.cells.length + 1,
			metadata: { pi: { cellId: event.id, status: "running", createdAt: event.createdAt } },
			outputs: [],
			source: sourceLines(event.source),
		});
		return;
	}
	if (existing) {
		const pi = isRecord(existing.metadata["pi"]) ? existing.metadata["pi"] : {};
		existing.metadata["pi"] = { ...pi, cellId: event.id, status: event.status, completedAt: event.completedAt };
		existing.outputs = event.outputs;
		return;
	}
	document.cells.push({
		cell_type: "code",
		execution_count: document.cells.length + 1,
		metadata: {
			pi: {
				cellId: event.id,
				status: event.status,
				createdAt: event.completedAt,
				completedAt: event.completedAt,
			},
		},
		outputs: event.outputs,
		source: sourceLines(event.source),
	});
}

export function readNotebookDocument(path: string): NotebookDocument | undefined {
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

export function writeNotebookDocument(path: string, document: NotebookDocument): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

export function sourceLines(source: string): string[] {
	const lines = source.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
	return lines.length > 0 ? lines : [""];
}

export function notebookCellId(cell: NotebookCell): string | undefined {
	const pi = cell.metadata["pi"];
	return isRecord(pi) && typeof pi["cellId"] === "string" ? pi["cellId"] : undefined;
}

export function notebookCellStatus(cell: NotebookCell): string | undefined {
	const pi = cell.metadata["pi"];
	return isRecord(pi) && typeof pi["status"] === "string" ? pi["status"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
