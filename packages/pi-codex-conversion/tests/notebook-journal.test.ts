import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	beginNotebookJournalCell,
	initializeNotebookJournal,
	materializeNotebookJournal,
	readNotebookJournalCodeCells,
} from "../src/tools/notebook-mode/journal.ts";

test("notebook journals rotate at the persistence budget without losing the previous document", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-notebook-journal-"));
	try {
		const journal = initializeNotebookJournal({ project: agentDir, session: "session", agentDir }, 1_024);
		beginNotebookJournalCell(journal, { id: "cell-1", source: `const old = ${JSON.stringify("x".repeat(2_000))};` });
		materializeNotebookJournal(journal);
		beginNotebookJournalCell(journal, { id: "cell-2", source: "const current = 2;" });
		materializeNotebookJournal(journal);

		assert.deepEqual(readNotebookJournalCodeCells(journal.path).map(({ id }) => id), ["cell-2"]);
		assert.deepEqual(
			readNotebookJournalCodeCells(journal.path.replace(/\.ipynb$/, ".previous.ipynb")).map(({ id }) => id),
			["cell-1"],
		);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
