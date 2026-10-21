import type Database from "better-sqlite3";

export interface UsageRow {
	kind: string;
	name: string;
	path: string;
	owner: string;
	submissions: number;
	skillReads: number;
	referenceReads: number;
	continuations: number;
	fileReads: number;
	fileReferenceReads: number;
	lastUsed: string | null;
	lastRead: string | null;
	lastSubmitted: string | null;
	firstAvailable: string | null;
	lastAvailable: string | null;
	daily: Array<{ day: string; agent: number; user: number }>;
}
export interface UsageOverview {
	rows: UsageRow[];
	coverage: {
		recordingSince: string | null;
		inventorySince: string | null;
		recordedSessions: number;
		sessions: number;
		fileReadScan: {
			phase: string;
			progress: number;
			unresolved: number;
			pending: number;
		};
		skillResultScan: { phase: string; progress: number };
	};
}

type UsageDayRow = Omit<UsageRow, "daily"> & {
	day: string | null;
	agent: number | null;
	user: number | null;
};

// These filters deliberately describe sessions and time, not model tool calls.
export function queryUsage(
	db: Database.Database,
	params: URLSearchParams,
): UsageOverview {
	const values = {
		session: params.get("session") ?? "",
		project: params.get("project") ?? "",
		since: params.get("since") ?? "",
		until: params.get("until") ?? "",
	};
	const fileScope =
		"(@session='' OR f.session_id=@session) AND (@project='' OR f.project=@project)";
	const scoped = Boolean(values.session || values.project);
	// Probe membership from the small observation set. Materialising the entire
	// session-history key set makes an all-sessions usage query scale with every message.
	const entryMember = (key: string) =>
		scoped
			? `EXISTS (SELECT 1 FROM file_entries fe JOIN files f ON f.id=fe.file_id WHERE fe.entry_key=${key} AND ${fileScope})`
			: "1";
	// Copied calls retain session membership, but their project is the resolved origin.
	const callMember = scoped
		? `EXISTS (SELECT 1 FROM file_calls fc JOIN files f ON f.id=fc.file_id JOIN calls c ON c.id=fc.call_id
			WHERE fc.call_id=e.call_id AND (@session='' OR f.session_id=@session) AND (@project='' OR c.project=@project))`
		: "1";
	const time =
		"(@since='' OR substr(timestamp,1,10)>=@since) AND (@until='' OR substr(timestamp,1,10)<=@until)";
	const dailyRows = db
		.prepare<typeof values, UsageDayRow>(`
		WITH selected_events AS (SELECT * FROM usage_events e WHERE kind IN ('extension','skill','prompt') AND owner<>'builtin'
			AND CASE WHEN e.call_id IS NULL THEN ${entryMember("e.entry_key")} ELSE ${callMember} END AND ${time}),
		available AS (SELECT i.*,s.timestamp FROM usage_inventory i JOIN usage_snapshots s USING(entry_key)
			WHERE i.kind IN ('extension','skill','prompt') AND owner<>'builtin' AND ${entryMember("i.entry_key")} AND (@until='' OR substr(timestamp,1,10)<=@until)),
		resources AS (SELECT kind,name,path,owner FROM selected_events UNION SELECT kind,name,path,owner FROM available WHERE kind='skill'),
		uses AS (SELECT kind,name,path,
			SUM(evidence='submission') submissions,
			SUM(evidence='skill_read') skillReads,SUM(evidence='reference_read') referenceReads,SUM(evidence='continuation') continuations,
			SUM(evidence='file_read') fileReads,SUM(evidence='file_reference_read') fileReferenceReads,
			MAX(timestamp) lastUsed,MAX(CASE WHEN evidence IN ('skill_read','reference_read','file_read','file_reference_read') THEN timestamp END) lastRead,
			MAX(CASE WHEN evidence='submission' THEN timestamp END) lastSubmitted FROM selected_events GROUP BY kind,name,path),
		seen AS (SELECT kind,name,path,MIN(timestamp) firstAvailable,MAX(timestamp) lastAvailable FROM available GROUP BY kind,name,path),
		selected_rows AS (SELECT r.kind,r.name,r.path,MAX(r.owner) owner,
			COALESCE(u.submissions,0) submissions,
			COALESCE(u.skillReads,0) skillReads,COALESCE(u.referenceReads,0) referenceReads,COALESCE(u.continuations,0) continuations,
			COALESCE(u.fileReads,0) fileReads,COALESCE(u.fileReferenceReads,0) fileReferenceReads,
			u.lastUsed,u.lastRead,u.lastSubmitted,s.firstAvailable,s.lastAvailable FROM resources r
			LEFT JOIN uses u USING(kind,name,path) LEFT JOIN seen s USING(kind,name,path)
			GROUP BY r.kind,r.name,r.path ORDER BY CASE WHEN r.kind='skill'
				THEN COALESCE(u.skillReads,0)+COALESCE(u.referenceReads,0)+COALESCE(u.fileReads,0)+COALESCE(u.fileReferenceReads,0)
				ELSE COALESCE(u.submissions,0) END DESC,r.name),
		actor_days AS (SELECT e.kind,e.name,e.path,substr(e.timestamp,1,10) day,
			CASE WHEN e.evidence='submission' THEN 'user' ELSE 'agent' END actor,COUNT(*) n
			FROM selected_events e JOIN selected_rows r USING(kind,name,path)
			WHERE e.evidence IN ('submission','skill_read','reference_read','file_read','file_reference_read')
			GROUP BY e.kind,e.name,e.path,day,actor),
		actor_windows AS (SELECT *,MAX(day) OVER (PARTITION BY kind,name,path,actor) latest FROM actor_days),
		daily AS (SELECT kind,name,path,day,SUM(CASE WHEN actor='agent' THEN n ELSE 0 END) agent,
			SUM(CASE WHEN actor='user' THEN n ELSE 0 END) user FROM actor_windows
			WHERE day>=date(latest,'-89 days') GROUP BY kind,name,path,day)
		SELECT r.*,d.day,d.agent,d.user FROM selected_rows r LEFT JOIN daily d USING(kind,name,path)
		ORDER BY CASE WHEN r.kind='skill' THEN r.skillReads+r.referenceReads+r.fileReads+r.fileReferenceReads
			ELSE r.submissions END DESC,r.name,r.kind,r.path,d.day
	`)
		.iterate(values);
	// Each actor keeps its own latest 90 calendar days. Anchoring both to a
	// skill's latest agent read would erase older command submissions (and vice versa).
	const resources = new Map<string, UsageRow>();
	for (const { day, agent, user, ...row } of dailyRows) {
		const key = JSON.stringify([row.kind, row.name, row.path]);
		let resource = resources.get(key);
		if (!resource) {
			resource = { ...row, daily: [] };
			resources.set(key, resource);
		}
		if (day !== null)
			resource.daily.push({ day, agent: agent ?? 0, user: user ?? 0 });
	}
	const rows = [...resources.values()];
	const coverage = db
		.prepare<
			typeof values,
			Omit<UsageOverview["coverage"], "fileReadScan" | "skillResultScan">
		>(`
		SELECT MIN(CASE WHEN kind='recording' THEN timestamp END) recordingSince,
			MIN(CASE WHEN kind='inventory' THEN timestamp END) inventorySince,
			(SELECT COUNT(DISTINCT f.session_id) FROM usage_snapshots rs
				JOIN file_entries fe ON fe.entry_key=rs.entry_key JOIN files f ON f.id=fe.file_id
				WHERE rs.kind='recording' AND ${fileScope} AND (@until='' OR substr(rs.timestamp,1,10)<=@until)) recordedSessions,
			(SELECT COUNT(DISTINCT f.session_id) FROM files f WHERE ${fileScope}) sessions
		FROM usage_snapshots s WHERE ${entryMember("s.entry_key")} AND (@until='' OR substr(timestamp,1,10)<=@until)
	`)
		.get(values);
	if (!coverage) throw new Error("Usage coverage is missing");
	const scan = Object.fromEntries(
		db
			.prepare<[], { key: string; value: string }>(
				"SELECT key,value FROM metadata WHERE key LIKE 'fileReadBackfill%' OR key LIKE 'skillResultBackfill%'",
			)
			.all()
			.map(({ key, value }) => [key, value]),
	);
	const phase = scan["fileReadBackfillPhase"] || "pending";
	const target = Number(scan["fileReadBackfillTarget"] || 0);
	const cursor = Number(scan["fileReadBackfillCursor"] || 0);
	const skillPhase = scan["skillResultBackfillPhase"] || "pending";
	const skillTarget = Number(scan["skillResultBackfillTarget"] || 0);
	const skillCursor = Number(scan["skillResultBackfillCursor"] || 0);
	const pending =
		db
			.prepare<[], { count: number }>(
				"SELECT COUNT(*) count FROM skill_file_replay",
			)
			.get()?.count || 0;
	const unresolved =
		db
			.prepare<[], { count: number }>(
				"SELECT COUNT(*) count FROM skill_file_gaps",
			)
			.get()?.count || 0;
	return {
		rows,
		coverage: {
			...coverage,
			skillResultScan: {
				phase: skillPhase,
				progress:
					skillPhase === "complete"
						? 100
						: skillTarget
							? Math.min(99, Math.floor((skillCursor / skillTarget) * 100))
							: 0,
			},
			fileReadScan: {
				phase: pending ? "rebuilding" : phase,
				progress: pending
					? 0
					: phase === "complete"
						? 100
						: target
							? Math.min(99, Math.floor((cursor / target) * 100))
							: 0,
				unresolved,
				pending,
			},
		},
	};
}
