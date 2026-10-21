import type Database from "better-sqlite3";
import { type CachedFileCall, createSkillFileIngestor } from "./skill-files.ts";

/** Prioritise historical Skills results instead of waiting behind unrelated tool calls. */
export function createSkillResultBackfill(db: Database.Database) {
	const files = createSkillFileIngestor(db);
	const metadata = db.prepare<[string], { value: string }>(
		"SELECT value FROM metadata WHERE key=?",
	);
	const putMeta = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	const candidates = db.prepare<
		{ cursor: number; target: number },
		CachedFileCall
	>(`
		WITH selected AS (
			SELECT id FROM calls INDEXED BY call_tool WHERE tool='skills' AND outcome='ok' AND id>@cursor AND id<=@target
			UNION ALL
			SELECT id FROM calls INDEXED BY call_tool WHERE tool='more_skills' AND outcome='ok' AND id>@cursor AND id<=@target
			ORDER BY id LIMIT 64
		)
		SELECT c.id,c.tool,c.project,c.timestamp,p.arguments FROM selected s JOIN calls c USING(id)
		JOIN payloads p ON p.call_id=c.id ORDER BY c.id
	`);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	return db.transaction((): boolean => {
		if (metadata.get("skillResultBackfillPhase")?.value === "complete")
			return false;
		if (!metadata.get("skillResultBackfillTarget")) {
			const maximum =
				db
					.prepare<[], { id: number }>(
						"SELECT COALESCE(MAX(id),0) id FROM calls",
					)
					.get()?.id || 0;
			putMeta.run("skillResultBackfillTarget", String(maximum));
			putMeta.run("skillResultBackfillCursor", "0");
			putMeta.run("skillResultBackfillPhase", "reading");
		}
		const cursor = Number(
			metadata.get("skillResultBackfillCursor")?.value || 0,
		);
		const target = Number(
			metadata.get("skillResultBackfillTarget")?.value || 0,
		);
		const batch = candidates.all({ cursor, target });
		for (const call of batch) files.replay(call);
		const last = batch.at(-1)?.id ?? target;
		putMeta.run("skillResultBackfillCursor", String(last));
		if (last >= target) putMeta.run("skillResultBackfillPhase", "complete");
		revision.run();
		return last < target;
	});
}

/** Discover recorded skill roots first, then replay cached calls. Never reread source JSONL. */
export function createSkillFileBackfill(db: Database.Database) {
	const files = createSkillFileIngestor(db);
	const metadata = db.prepare<[string], { value: string }>(
		"SELECT value FROM metadata WHERE key=?",
	);
	const putMeta = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	const candidates = db.prepare<[number, number], CachedFileCall>(`
		SELECT c.id,c.tool,c.project,c.timestamp,p.arguments FROM calls c JOIN payloads p ON p.call_id=c.id
		WHERE c.id>? AND c.id<=? AND c.outcome='ok' ORDER BY c.id LIMIT 128
	`);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	const resolved = db.prepare<[], CachedFileCall>(`
		SELECT c.id,c.tool,c.project,c.timestamp,p.arguments
		FROM (SELECT call_id FROM skill_file_replay ORDER BY call_id LIMIT 128) r
		JOIN calls c ON c.id=r.call_id JOIN payloads p ON p.call_id=c.id
		ORDER BY c.id
	`);
	const clearResolved = db.prepare(
		"DELETE FROM skill_file_replay WHERE call_id=?",
	);
	return db.transaction((): boolean => {
		const ready = resolved.all();
		if (ready.length) {
			for (const call of ready) {
				files.replay(call);
				clearResolved.run(call.id);
			}
			revision.run();
			return true;
		}
		let phase = metadata.get("fileReadBackfillPhase")?.value;
		if (phase === "complete") return false;
		if (!phase) {
			// Start after native-call migration has finished so its newly recovered calls join this scan.
			const maximum =
				db
					.prepare<[], { id: number }>(
						"SELECT COALESCE(MAX(id),0) id FROM calls",
					)
					.get()?.id || 0;
			putMeta.run("fileReadBackfillTarget", String(maximum));
			putMeta.run("fileReadBackfillCursor", "0");
			putMeta.run("fileReadBackfillPhase", "discovery");
			phase = "discovery";
			for (const row of db
				.prepare<[], { path: string; name: string }>(`
				SELECT path,name FROM usage_events WHERE kind='skill' AND evidence IN ('skill_read','reference_read','continuation')
				UNION SELECT path,name FROM usage_inventory WHERE kind='skill'
			`)
				.all())
				files.register(row.path, row.name, true);
		}
		const cursor = Number(metadata.get("fileReadBackfillCursor")?.value || 0);
		const target = Number(metadata.get("fileReadBackfillTarget")?.value || 0);
		const batch = candidates.all(cursor, target);
		for (const call of batch) {
			if (phase === "discovery") files.discover(call);
			else files.replay(call);
		}
		const last = batch.at(-1)?.id ?? target;
		putMeta.run("fileReadBackfillCursor", String(last));
		if (last >= target) {
			putMeta.run(
				"fileReadBackfillPhase",
				phase === "discovery" ? "reading" : "complete",
			);
			if (phase === "discovery") putMeta.run("fileReadBackfillCursor", "0");
		}
		revision.run();
		return phase === "discovery" || last < target;
	});
}
