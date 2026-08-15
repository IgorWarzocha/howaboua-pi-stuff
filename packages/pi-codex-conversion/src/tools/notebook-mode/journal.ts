import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RuntimeContentItem } from "../code-mode/types.ts";
import {
	applyNotebookJournalEvent,
	emptyNotebookDocument,
	notebookCellId,
	notebookCellStatus,
	readNotebookDocument,
	type NotebookJournalEvent,
	writeNotebookDocument,
} from "./journal-document.ts";
import type { KernelExecutionResult } from "./jupyter-kernel.ts";

const MAX_CELL_OUTPUT_CHARS = 16 * 1024 * 1024;
const JOURNAL_DOCUMENT_OVERHEAD_BYTES = 4_096;

export interface NotebookJournal {
	path: string;
	eventsPath: string;
	project: string;
	session: string;
	cells: number;
	completedCells: number;
	writable: boolean;
	maxBytes: number;
}

export interface NotebookJournalCodeCell {
	id: string;
	index: number;
	source: string;
}

export function initializeNotebookJournal(
	identity: { project: string; session: string; agentDir: string },
	maxBytes: number,
): NotebookJournal {
	const project = resolve(identity.project);
	const projectKey = createHash("sha256").update(project).digest("hex");
	const sessionKey = createHash("sha256").update(identity.session).digest("hex");
	const directory = join(identity.agentDir, "cache", "pi-codex-conversion", "notebook-mode", "journals", projectKey);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${sessionKey}.ipynb`);
	const eventsPath = journalEventsPath(path);
	const previousPath = previousJournalPath(path);
	for (const candidate of [path, eventsPath, previousPath]) {
		if (fileSize(candidate) > maxBytes) rmSync(candidate, { force: true });
	}
	if (!existsSync(path)) writeNotebookDocument(path, emptyNotebookDocument(project, identity.session), maxBytes);
	if (!existsSync(eventsPath)) writeFileSync(eventsPath, "", { mode: 0o600 });
	const journal = { path, eventsPath, project, session: identity.session, cells: 0, completedCells: 0, writable: true, maxBytes };
	try { materializeNotebookJournal(journal); } catch { journal.writable = false; }
	const document = readNotebookDocument(path, maxBytes);
	if (!document) journal.writable = false;
	journal.cells = document?.cells.length ?? 0;
	journal.completedCells = document?.cells.filter((cell) => notebookCellStatus(cell) !== "running").length ?? 0;
	return journal;
}

export function beginNotebookJournalCell(journal: NotebookJournal, cell: { id: string; source: string }): void {
	if (!journal.writable) throw new Error(`Notebook journal requires diagnostics: ${journal.path}`);
	appendEvent(journal, { type: "begin", id: cell.id, source: cell.source, createdAt: new Date().toISOString() });
	journal.cells += 1;
}

function rotateNotebookJournalIfNeeded(journal: NotebookJournal, incomingBytes: number): boolean {
	if (fileSize(journal.path) + fileSize(journal.eventsPath) + incomingBytes <= journal.maxBytes) return false;
	materializeNotebookJournal(journal);
	if (fileSize(journal.path) + incomingBytes <= journal.maxBytes) return false;
	const previous = previousJournalPath(journal.path);
	const replacement = `${journal.path}.replacement`;
	writeNotebookDocument(replacement, emptyNotebookDocument(journal.project, journal.session), journal.maxBytes);
	try {
		rmSync(previous, { force: true });
		renameSync(journal.path, previous);
		renameSync(replacement, journal.path);
	} finally {
		rmSync(replacement, { force: true });
	}
	journal.cells = 0;
	journal.completedCells = 0;
	if (fileSize(journal.path) + incomingBytes > journal.maxBytes) {
		throw new Error("Notebook journal cell exceeds the persistence budget");
	}
	return true;
}

function fileSize(path: string): number {
	try { return statSync(path).size; } catch { return 0; }
}

export function finishNotebookJournalCell(
	journal: NotebookJournal,
	cell: { id: string; source: string; items: RuntimeContentItem[]; result: KernelExecutionResult },
): void {
	if (!journal.writable) throw new Error(`Notebook journal requires diagnostics: ${journal.path}`);
	const rotated = appendEvent(journal, {
		type: "finish",
		id: cell.id,
		source: cell.source,
		status: cell.result.status,
		completedAt: new Date().toISOString(),
		outputs: journalOutputs(
			cell.items,
			cell.result,
			Math.min(MAX_CELL_OUTPUT_CHARS, Math.max(0, Math.floor((journal.maxBytes - Buffer.byteLength(cell.source) - JOURNAL_DOCUMENT_OVERHEAD_BYTES) / 6))),
		),
	});
	if (rotated) journal.cells = 1;
	journal.completedCells += 1;
}

export function materializeNotebookJournal(journal: NotebookJournal): void {
	const document = readNotebookDocument(journal.path, journal.maxBytes);
	if (!document) throw new Error(`Notebook journal is invalid: ${journal.path}`);
	const events = readEvents(journal.eventsPath, journal.maxBytes);
	if (events.length === 0) return;
	for (const event of events) applyNotebookJournalEvent(document, event);
	writeNotebookDocument(journal.path, document, journal.maxBytes);
	writeFileSync(journal.eventsPath, "", { mode: 0o600 });
	journal.writable = true;
}

export function readNotebookJournalCodeCells(path: string): NotebookJournalCodeCell[] {
	const document = materializedDocument(path);
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

function materializedDocument(path: string) {
	const document = readNotebookDocument(path);
	if (!document) throw new Error(`Notebook journal is invalid: ${path}`);
	for (const event of readEvents(journalEventsPath(path))) applyNotebookJournalEvent(document, event);
	return document;
}

function appendEvent(journal: NotebookJournal, event: NotebookJournalEvent): boolean {
	const line = `${JSON.stringify(event)}\n`;
	const bytes = Buffer.byteLength(line);
	if (bytes + JOURNAL_DOCUMENT_OVERHEAD_BYTES > journal.maxBytes) {
		throw new Error("Notebook journal cell exceeds the persistence budget");
	}
	const rotated = rotateNotebookJournalIfNeeded(journal, bytes);
	appendFileSync(journal.eventsPath, line, { encoding: "utf8", mode: 0o600 });
	return rotated;
}

function readEvents(path: string, maxBytes?: number): NotebookJournalEvent[] {
	if (!existsSync(path)) return [];
	try {
		if (maxBytes !== undefined && fileSize(path) > maxBytes) throw new Error("events exceed budget");
		const text = readFileSync(path, "utf8");
		const lines = text.split("\n");
		const events: NotebookJournalEvent[] = [];
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]!;
			if (!line) continue;
			try {
				const value = JSON.parse(line) as unknown;
				if (!isNotebookJournalEvent(value)) throw new Error("invalid event");
				events.push(value);
			} catch (error) {
				if (index === lines.length - 1 && !text.endsWith("\n")) break;
				throw error;
			}
		}
		return events;
	} catch {
		throw new Error(`Notebook journal events are invalid: ${path}`);
	}
}

function isNotebookJournalEvent(value: unknown): value is NotebookJournalEvent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const event = value as Record<string, unknown>;
	if (typeof event["id"] !== "string" || typeof event["source"] !== "string") return false;
	return event["type"] === "begin"
		? typeof event["createdAt"] === "string"
		: event["type"] === "finish"
			&& typeof event["status"] === "string"
			&& typeof event["completedAt"] === "string"
			&& Array.isArray(event["outputs"]);
}

function journalEventsPath(path: string): string {
	return `${path}.events.jsonl`;
}

function previousJournalPath(path: string): string {
	return path.replace(/\.ipynb$/, ".previous.ipynb");
}

function journalOutputs(items: RuntimeContentItem[], result: KernelExecutionResult, maxChars: number): Array<Record<string, unknown>> {
	const outputs: Array<Record<string, unknown>> = [];
	let remaining = maxChars;
	for (const item of items) {
		if (remaining <= 0) break;
		if (item.type === "input_text" && item.text) {
			const text = item.text.slice(0, remaining);
			remaining -= text.length;
			outputs.push({ name: "stdout", output_type: "stream", text });
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
		outputs.push({ output_type: "error", ename: "NotebookCellError", evalue: errorText, traceback: errorText.split("\n") });
	}
	return outputs;
}
