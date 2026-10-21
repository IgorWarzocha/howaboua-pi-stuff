import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "./database.ts";
import { BadRequest, createQueries } from "./queries.ts";

const db = openDatabase(String(workerData), true);
const query = createQueries(db);
parentPort?.on(
	"message",
	(message: { id: number; path: string; search: string } | "stop") => {
		if (message === "stop") {
			db.close();
			parentPort?.close();
			return;
		}
		try {
			const value = query(message.path, new URLSearchParams(message.search));
			parentPort?.postMessage({
				id: message.id,
				value,
				status: value === null ? 404 : 200,
			});
		} catch (error) {
			parentPort?.postMessage({
				id: message.id,
				status: error instanceof BadRequest ? 400 : 500,
				value: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	},
);
