import { setTimeout } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";
import { createCodemodeBackfill } from "./codemode-backfill.ts";
import { openDatabase } from "./database.ts";
import { createIndexer } from "./indexer.ts";
import type { MonitorMode } from "./monitor.ts";
import { createNestedBackfill } from "./nested-backfill.ts";
import {
	createSkillFileBackfill,
	createSkillResultBackfill,
} from "./skill-files-backfill.ts";
import { createObservedToolBackfill } from "./tool-observations.ts";

const { database, sessions, observationsRoot } = workerData as {
	database: string;
	sessions: string;
	observationsRoot?: string;
};
const db = openDatabase(database);
const indexer = createIndexer(db, sessions, observationsRoot);
const backfill = createNestedBackfill(db);
const codemode = createCodemodeBackfill(db);
const observations = createObservedToolBackfill(db);
const fileReads = createSkillFileBackfill(db);
const skillResults = createSkillResultBackfill(db);
const shutdown = new AbortController();
const control: { mode: MonitorMode } = { mode: "paused" };
let generation = 0;
let wake: (() => void) | undefined;
const revision = db.prepare<[], { value: string }>(
	"SELECT value FROM metadata WHERE key='revision'",
);
function publish(busy: boolean): void {
	parentPort?.postMessage({
		generation,
		busy,
		revision: Number(revision.get()?.value ?? 0),
	});
}
parentPort?.on("message", (message) => {
	if (message === "stop") {
		indexer.stop();
		shutdown.abort();
	} else if (
		message?.mode === "paused" ||
		message?.mode === "catch-up" ||
		message?.mode === "live"
	) {
		control.mode = message.mode;
		generation = message.generation;
	}
	wake?.();
});
publish(false);
try {
	while (!shutdown.signal.aborted) {
		if (control.mode === "paused") {
			publish(false);
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
			wake = undefined;
			continue;
		}
		const run = generation;
		const keepGoing = () => !shutdown.signal.aborted && generation === run;
		publish(true);
		const progress = globalThis.setInterval(() => publish(true), 2000);
		try {
			await indexer.scan(keepGoing);
			while (
				keepGoing() &&
				(backfill() ||
					codemode() ||
					skillResults() ||
					fileReads() ||
					observations())
			) {
				await setTimeout(0);
			}
		} finally {
			clearInterval(progress);
		}
		if (generation === run && control.mode === "catch-up")
			control.mode = "paused";
		if (generation === run) publish(false);
		if (control.mode === "live" && keepGoing())
			await new Promise<void>((resolve) => {
				const timer = globalThis.setTimeout(resolve, 2000);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			}).finally(() => {
				wake = undefined;
			});
	}
} finally {
	db.close();
	parentPort?.close();
}
