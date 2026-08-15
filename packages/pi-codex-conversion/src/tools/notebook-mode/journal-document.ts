import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const NOTEBOOK_FORMAT = 4;
const NOTEBOOK_MINOR = 5;

export interface NotebookDocument {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat: number;
	nbformat_minor: number;
}

export interface NotebookCell {
	id: string;
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
			id: event.id,
			cell_type: "code",
			execution_count: document.cells.length + 1,
			metadata: { pi: { cellId: event.id, status: "running", createdAt: event.createdAt } },
			outputs: [],
			source: event.source,
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
		id: event.id,
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
		source: event.source,
	});
}

export function readNotebookDocument(path: string, maxBytes?: number): NotebookDocument | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || maxBytes !== undefined && stat.size > maxBytes) return undefined;
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || !Array.isArray(value["cells"]) || !isRecord(value["metadata"])) return undefined;
		if (value["nbformat"] !== NOTEBOOK_FORMAT || value["nbformat_minor"] !== NOTEBOOK_MINOR) return undefined;
		const ids = new Set<string>();
		const cells = value["cells"].map((cell, index) => {
			if (!isRecord(cell) || typeof cell["cell_type"] !== "string" || !isRecord(cell["metadata"])) return undefined;
			if (typeof cell["source"] !== "string" && !Array.isArray(cell["source"])) return undefined;
			const legacyId = isRecord(cell["metadata"]["pi"]) ? cell["metadata"]["pi"]["cellId"] : undefined;
			const id = validCellId(cell["id"]) ? cell["id"] : validCellId(legacyId) ? legacyId : `cell-${index + 1}`;
			if (ids.has(id)) return undefined;
			ids.add(id);
			return { ...cell, id } as unknown as NotebookCell;
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

export function writeNotebookDocument(path: string, document: NotebookDocument, maxBytes?: number): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const pretty = `${JSON.stringify(document, null, 2)}\n`;
	const text = maxBytes !== undefined && Buffer.byteLength(pretty) > maxBytes
		? `${JSON.stringify(document)}\n`
		: pretty;
	if (maxBytes !== undefined && Buffer.byteLength(text) > maxBytes) {
		throw new Error("Notebook journal document exceeds the persistence budget");
	}
	writeFileSync(temporary, text, { mode: 0o600 });
	renameSync(temporary, path);
}

export function notebookCellId(cell: NotebookCell): string | undefined {
	return cell.id;
}

export function notebookCellStatus(cell: NotebookCell): string | undefined {
	const pi = cell.metadata["pi"];
	return isRecord(pi) && typeof pi["status"] === "string" ? pi["status"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCellId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
