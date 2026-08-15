import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	beginNotebookJournalCell,
	finishNotebookJournalCell,
	initializeNotebookJournal,
	materializeNotebookJournal,
	readNotebookJournalCodeCells,
} from "../src/tools/notebook-mode/journal.ts";

test("notebook journals rotate at the persistence budget without losing the previous document", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-notebook-journal-"));
	try {
		const maxBytes = 16_384;
		const journal = initializeNotebookJournal({ project: agentDir, session: "session", agentDir }, maxBytes);
		const source = `const old = ${JSON.stringify("x".repeat(11_000))};`;
		beginNotebookJournalCell(journal, { id: "cell-1", source });
		finishNotebookJournalCell(journal, { id: "cell-1", source, items: [], result: { status: "ok", items: [] } });
		assert.ok(statSync(journal.path).size + statSync(journal.eventsPath).size <= maxBytes);
		materializeNotebookJournal(journal);
		assert.ok(statSync(journal.path).size <= maxBytes);
		assert.ok(statSync(journal.path.replace(/\.ipynb$/, ".previous.ipynb")).size <= maxBytes);

		assert.deepEqual(readNotebookJournalCodeCells(journal.path).map(({ id }) => id), ["cell-1"]);
		assert.deepEqual(
			readNotebookJournalCodeCells(journal.path.replace(/\.ipynb$/, ".previous.ipynb")).map(({ id }) => id),
			["cell-1"],
		);
		const document = JSON.parse(readFileSync(journal.path, "utf8")) as { cells: Array<{ id?: string }> };
		assert.equal(document.cells[0]?.id, "cell-1");
		const previous = journal.path.replace(/\.ipynb$/, ".previous.ipynb");
		writeFileSync(previous, "x".repeat(maxBytes + 1));
		initializeNotebookJournal({ project: agentDir, session: "session", agentDir }, maxBytes);
		assert.equal(existsSync(previous), false);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
