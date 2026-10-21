import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RebillState } from "./rebill.ts";
import type { Header } from "./requests.ts";

export interface FileCursor {
	identity: string;
	offset: number;
	tail: string;
	discarding: boolean;
	anchor: string;
	header: Header;
	malformed: number;
	invalidUsage: number;
	rewrites: number;
	rebill?: RebillState;
	rebillVersion?: number;
}
export function openIndex(
	stateDirectory: string,
	directory: string,
): DatabaseSync {
	mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
	const db = new DatabaseSync(join(stateDirectory, "collector.sqlite"));
	db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
		CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, data TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, file TEXT NOT NULL REFERENCES files(name) ON DELETE CASCADE,
			day TEXT NOT NULL, time TEXT NOT NULL, data TEXT NOT NULL);
		CREATE INDEX IF NOT EXISTS record_time ON records(time DESC, id);
		CREATE INDEX IF NOT EXISTS record_day ON records(day);`);
	db.exec(`CREATE TABLE IF NOT EXISTS rebill_files (
		name TEXT PRIMARY KEY REFERENCES files(name) ON DELETE CASCADE, data TEXT NOT NULL);`);
	const previous = db
		.prepare("SELECT value FROM meta WHERE key='directory'")
		.get();
	if (previous && previous["value"] !== directory) {
		db.close();
		throw new Error(
			"Collector state belongs to another log directory; use a separate tab state directory.",
		);
	}
	db.prepare("INSERT OR IGNORE INTO meta VALUES ('directory', ?)").run(
		directory,
	);
	db.exec("INSERT OR IGNORE INTO meta VALUES ('revision', '0')");
	return db;
}

export function blankCursor(identity: string, rewrites = 0): FileCursor {
	return {
		identity,
		offset: 0,
		tail: "",
		discarding: false,
		anchor: createHash("sha256").digest("hex"),
		header: { epoch: 0, sessionId: null, sessionName: null, project: null },
		malformed: 0,
		invalidUsage: 0,
		rewrites,
	};
}
