import { setTimeout } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "./database.ts";
import { createIndexer } from "./indexer.ts";
import { createNestedBackfill } from "./nested-backfill.ts";
import { createSkillFileBackfill } from "./skill-files-backfill.ts";

const { database, sessions, observationsRoot } = workerData as {
	database: string;
	sessions: string;
	observationsRoot?: string;
};
const db = openDatabase(database);
const indexer = createIndexer(db, sessions, observationsRoot);
const backfill = createNestedBackfill(db);
const fileReads = createSkillFileBackfill(db);
const shutdown = new AbortController();
parentPort?.on("message", (message) => {
	if (message === "stop") {
		indexer.stop();
		shutdown.abort();
	}
});
try {
	let nextScan = 0;
	while (!shutdown.signal.aborted) {
		if (Date.now() >= nextScan) {
			await indexer.scan();
			nextScan = Date.now() + 2000;
		}
		const pending = !shutdown.signal.aborted && (backfill() || fileReads());
		try {
			await setTimeout(
				pending ? 0 : Math.max(0, nextScan - Date.now()),
				undefined,
				{ signal: shutdown.signal },
			);
		} catch (error) {
			if (!shutdown.signal.aborted) throw error;
		}
	}
} finally {
	db.close();
	parentPort?.close();
}
