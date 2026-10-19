import { setTimeout } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "./database.ts";
import { createIndexer } from "./indexer.ts";

const { database, sessions } = workerData as {
	database: string;
	sessions: string;
};
const db = openDatabase(database);
const indexer = createIndexer(db, sessions);
const shutdown = new AbortController();
parentPort?.on("message", (message) => {
	if (message === "stop") {
		indexer.stop();
		shutdown.abort();
	}
});
try {
	while (!shutdown.signal.aborted) {
		await indexer.scan();
		try {
			await setTimeout(2000, undefined, { signal: shutdown.signal });
		} catch (error) {
			if (!shutdown.signal.aborted) throw error;
		}
	}
} finally {
	db.close();
	parentPort?.close();
}
