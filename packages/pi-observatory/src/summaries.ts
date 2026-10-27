import type Database from "better-sqlite3";

// Maintain the dashboard's common date/model/tool slices in the same transaction as each call.
// The UI never scans payloads, and growing histories do not require repeatedly counting every call.
export function initialiseSummaries(db: Database.Database): void {
	const dimensions = [
		"day",
		"provider",
		"model",
		"tool",
		"project",
		"scope",
		"outcome",
		"signature",
	];
	const fresh = dimensions.map((key) =>
		key === "day" ? "substr(new.timestamp,1,10)" : `new.${key}`,
	);
	const old = dimensions
		.map(
			(key) =>
				`${key}=${key === "day" ? "substr(old.timestamp,1,10)" : `old.${key}`}`,
		)
		.join(" AND ");
	const add = `INSERT INTO tallies(${dimensions.join(",")},n,last_seen) VALUES(${fresh.join(",")},1,new.timestamp)
		ON CONFLICT(${dimensions.join(",")}) DO UPDATE SET n=n+1,last_seen=MAX(last_seen,new.timestamp);`;
	db.exec(`
		INSERT OR IGNORE INTO metadata VALUES('entries', (SELECT COUNT(*) FROM entry_refs));
		CREATE TRIGGER IF NOT EXISTS entry_count AFTER INSERT ON entry_refs BEGIN
			UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='entries';
		END;
		CREATE TABLE IF NOT EXISTS tallies (
			${dimensions.map((key) => `${key} TEXT NOT NULL`).join(",")}, n INTEGER NOT NULL, last_seen TEXT NOT NULL,
			PRIMARY KEY(${dimensions.join(",")})
		) WITHOUT ROWID;
		CREATE TABLE IF NOT EXISTS coverage (
			id INTEGER PRIMARY KEY CHECK(id=1), unpaired INTEGER NOT NULL, missing INTEGER NOT NULL, dropped INTEGER NOT NULL
		);
		INSERT OR IGNORE INTO coverage VALUES(1,0,0,0);
		CREATE TRIGGER IF NOT EXISTS tally_insert AFTER INSERT ON calls BEGIN
			${add}
			UPDATE coverage SET unpaired=unpaired+new.unpaired,missing=missing+new.missing_traces,dropped=dropped+new.dropped_traces WHERE id=1;
		END;
		CREATE TRIGGER IF NOT EXISTS tally_update AFTER UPDATE OF outcome,signature,missing_traces,dropped_traces,project ON calls WHEN old.outcome<>new.outcome OR old.signature<>new.signature OR old.missing_traces<>new.missing_traces OR old.dropped_traces<>new.dropped_traces OR old.project<>new.project BEGIN
			UPDATE tallies SET n=n-1 WHERE ${old};
			DELETE FROM tallies WHERE ${old} AND n=0;
			${add}
			UPDATE coverage SET unpaired=unpaired+new.unpaired-old.unpaired,
				missing=missing+new.missing_traces-old.missing_traces,dropped=dropped+new.dropped_traces-old.dropped_traces WHERE id=1;
		END;
	`);
}
