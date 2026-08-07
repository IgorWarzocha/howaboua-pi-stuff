import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface ChunkRow {
	id: number;
	file: string;
	start_line: number;
	end_line: number;
	text: string;
	vector: string;
}

export interface FileRow {
	file: string;
	hash: string;
	size: number;
	mtime_ms: number;
	indexed_at: string;
	index_fingerprint: string;
	index_generation: number;
	chunk_count: number;
}

export interface BuildTarget {
	fingerprint: string;
	generation: number;
	fullRebuild: boolean;
}

const SCHEMA_VERSION = "5";

export function dbPathFor(root: string): string {
	return path.join(root, ".pi", "semantic-grep.sqlite");
}

export function indexLockPathFor(root: string): string {
	return path.join(root, ".pi", "semantic-grep.index.lock");
}

function createSchema(db: Database.Database): void {
	db.exec(`
    create table if not exists meta (key text primary key, value text not null);
    create table if not exists files (
      file text primary key,
      hash text not null,
      size integer not null,
      mtime_ms real not null,
      indexed_at text not null,
      index_fingerprint text not null default '',
      index_generation integer not null default 0,
      chunk_count integer not null default 0
    );
    create table if not exists chunks (
      id integer primary key,
      file text not null,
      start_line integer not null,
      end_line integer not null,
      text text not null,
      hash text not null,
      vector text not null,
      chunk_key text,
      foreign key(file) references files(file) on delete cascade
    );
    create index if not exists chunks_file_idx on chunks(file);
  `);
}

function columnNames(db: Database.Database, table: string): Set<string> {
	return new Set(
		(
			db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
		).map((row) => row.name),
	);
}

function migrateSchema(db: Database.Database): void {
	const fileColumns = columnNames(db, "files");
	const chunkColumns = columnNames(db, "chunks");
	const migrate = db.transaction(() => {
		if (!fileColumns.has("index_fingerprint"))
			db.exec(
				"alter table files add column index_fingerprint text not null default ''",
			);
		if (!fileColumns.has("index_generation"))
			db.exec(
				"alter table files add column index_generation integer not null default 0",
			);
		if (!fileColumns.has("chunk_count"))
			db.exec(
				"alter table files add column chunk_count integer not null default -1",
			);
		if (!chunkColumns.has("chunk_key"))
			db.exec("alter table chunks add column chunk_key text");

		const legacyFingerprint = getMeta(db, "index_fingerprint") ?? "";
		if (legacyFingerprint) {
			db.prepare(
				"update files set index_fingerprint = ?, index_generation = 1 where index_fingerprint = ''",
			).run(legacyFingerprint);
			if (!getMeta(db, "active_fingerprint")) {
				setMeta(db, "active_fingerprint", legacyFingerprint);
				setMeta(db, "active_generation", "1");
			}
		}
		db.exec(`
      update files
      set chunk_count = (select count(*) from chunks where chunks.file = files.file)
      where chunk_count < 0;
      create unique index if not exists chunks_file_key_uidx
      on chunks(file, chunk_key) where chunk_key is not null;
    `);
		setMeta(db, "schema_version", SCHEMA_VERSION);
	});
	migrate();
}

export function openIndexDb(root: string): Database.Database {
	mkdirSync(path.join(root, ".pi"), { recursive: true });
	const db = new Database(dbPathFor(root));
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	createSchema(db);
	migrateSchema(db);
	return db;
}

export function openSearchDb(root: string): Database.Database {
	const db = new Database(dbPathFor(root), {
		readonly: true,
		fileMustExist: true,
	});
	db.pragma("query_only = ON");
	db.pragma("busy_timeout = 5000");
	return db;
}

export function getMeta(
	db: Database.Database,
	key: string,
): string | undefined {
	return (
		db.prepare("select value from meta where key = ?").get(key) as
			| { value: string }
			| undefined
	)?.value;
}

export function setMeta(
	db: Database.Database,
	key: string,
	value: string,
): void {
	db.prepare(
		"insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
	).run(key, value);
}

function metaGeneration(db: Database.Database, key: string): number {
	const value = Number.parseInt(getMeta(db, key) ?? "0", 10);
	return Number.isFinite(value) ? value : 0;
}

export function prepareBuildTarget(
	db: Database.Database,
	fingerprint: string,
	force: boolean,
): BuildTarget {
	const activeFingerprint = getMeta(db, "active_fingerprint") ?? "";
	const activeGeneration = metaGeneration(db, "active_generation");
	const pendingFingerprint = getMeta(db, "target_fingerprint") ?? "";
	const pendingGeneration = metaGeneration(db, "target_generation");

	let generation: number;
	if (!force && pendingFingerprint === fingerprint && pendingGeneration > 0) {
		generation = pendingGeneration;
	} else if (!force && activeFingerprint === fingerprint) {
		generation = activeGeneration || 1;
	} else {
		generation = Math.max(activeGeneration, pendingGeneration) + 1;
	}
	setMeta(db, "target_fingerprint", fingerprint);
	setMeta(db, "target_generation", String(generation));
	setMeta(db, "build_started_at", new Date().toISOString());
	return {
		fingerprint,
		generation,
		fullRebuild:
			force ||
			activeFingerprint !== fingerprint ||
			activeGeneration !== generation,
	};
}

export function completeBuild(
	db: Database.Database,
	target: BuildTarget,
	model: string,
): void {
	const complete = db.transaction(() => {
		setMeta(db, "active_fingerprint", target.fingerprint);
		setMeta(db, "active_generation", String(target.generation));
		setMeta(db, "index_fingerprint", target.fingerprint);
		setMeta(db, "indexed_at", new Date().toISOString());
		setMeta(db, "embedding_model", model);
		db.prepare(
			"delete from meta where key in ('target_fingerprint', 'target_generation', 'build_started_at')",
		).run();
	});
	complete();
}
