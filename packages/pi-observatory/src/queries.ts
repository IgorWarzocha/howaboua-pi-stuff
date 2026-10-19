import type Database from "better-sqlite3";
import type {
	CallDetail,
	CallPage,
	CallRow,
	Counts,
	Facets,
	IndexStatus,
	Overview,
	SessionPage,
} from "./contracts.ts";
import { object, string } from "./normalise.ts";

export class BadRequest extends Error {}

function countColumns(weight: string): string {
	return `COALESCE(SUM(${weight}),0) calls, ${["ok", "error", "nonzero", "cancelled", "blocked", "pending", "unknown"].map((status) => `COALESCE(SUM(CASE WHEN outcome='${status}' THEN ${weight} ELSE 0 END),0) ${status}`).join(",")}`;
}
const columns = `id,timestamp,provider,model,tool,scope,outcome,exit_code exitCode,signature,preview,project`;
const issues = "('error','nonzero','cancelled','blocked')";

function filters(params: URLSearchParams) {
	const conditions: string[] = [];
	const values: Record<string, string | number> = {};
	const session = params.get("session");
	if (session) {
		if (session.length > 256) throw new BadRequest("Session ID is too long");
		values["session"] = session;
		// Membership follows persisted history, not the first file that happened to index a copied call.
		conditions.push(`id IN (
			SELECT c.call_id FROM files f JOIN file_calls c ON c.file_id=f.id WHERE f.session_id=@session
		)`);
	}
	for (const name of ["provider", "model", "tool", "project"]) {
		const value = params.get(name);
		if (!value) continue;
		if (value.length > 4096) throw new BadRequest(`Filter ${name} is too long`);
		conditions.push(`${name}=@${name}`);
		values[name] = value;
	}
	const scope = params.get("scope") || "all";
	if (!["all", "direct", "nested"].includes(scope))
		throw new BadRequest("Invalid call scope");
	if (scope !== "all") {
		conditions.push("scope=@scope");
		values["scope"] = scope;
	}
	for (const name of ["since", "until"]) {
		const value = params.get(name);
		if (!value) continue;
		const date = new Date(value);
		if (
			!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
			!Number.isFinite(date.getTime()) ||
			date.toISOString().slice(0, 10) !== value.slice(0, 10)
		)
			throw new BadRequest("Dates must be valid ISO dates");
		if (name === "until" && value.length === 10)
			date.setUTCDate(date.getUTCDate() + 1);
		conditions.push(
			`${name === "since" ? "timestamp>=@since" : "timestamp<@until"}`,
		);
		values[name] = date.toISOString();
	}
	const query = params.get("q")?.trim();
	if (query) {
		if (query.length > 512)
			throw new BadRequest("Search is limited to 512 characters");
		const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32);
		if (!tokens?.length) throw new BadRequest("Search needs a word or number");
		conditions.push(
			"id IN (SELECT rowid FROM call_search WHERE call_search MATCH @query)",
		);
		values["query"] = tokens.map((token) => `"${token}"*`).join(" AND ");
	}
	return { conditions, values };
}

function where(conditions: string[]): string {
	return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function integer(value: string | null, fallback: number, max: number): number {
	if (value === null) return fallback;
	const number = Number(value);
	if (
		!/^\d+$/.test(value) ||
		!Number.isSafeInteger(number) ||
		number < 1 ||
		number > max
	)
		throw new BadRequest("Invalid page limit or cursor");
	return number;
}

export function createQueries(db: Database.Database) {
	function overview(params: URLSearchParams): Overview {
		let { conditions, values } = filters(params);
		const aggregated =
			!params.get("session") &&
			!params.get("q")?.trim() &&
			["since", "until"].every(
				(key) => !params.get(key) || params.get(key)?.length === 10,
			);
		const source = aggregated ? "tallies" : "calls";
		const counts = countColumns(aggregated ? "n" : "1");
		const weight = aggregated ? "SUM(n)" : "COUNT(*)";
		const time = aggregated ? "last_seen" : "timestamp";
		const day = aggregated ? "day" : "substr(timestamp,1,10)";
		if (aggregated) {
			conditions = conditions.map((condition) =>
				condition.replace("timestamp", "day"),
			);
			for (const key of ["since", "until"])
				if (typeof values[key] === "string")
					values[key] = values[key].slice(0, 10);
		}
		const clause = where(conditions);
		const totals = db
			.prepare<Record<string, string | number>, Counts>(
				`SELECT ${counts} FROM ${source} ${clause}`,
			)
			.get(values);
		if (!totals) throw new Error("Could not read call totals");
		return {
			totals,
			byModel: db
				.prepare<Record<string, string | number>, Overview["byModel"][number]>(
					`SELECT provider,model,${counts} FROM ${source} ${clause} GROUP BY provider,model ORDER BY error DESC,calls DESC LIMIT 100`,
				)
				.all(values),
			byTool: db
				.prepare<Record<string, string | number>, Overview["byTool"][number]>(
					`SELECT tool,${counts} FROM ${source} ${clause} GROUP BY tool ORDER BY error DESC,calls DESC LIMIT 100`,
				)
				.all(values),
			groups: db
				.prepare<Record<string, string | number>, Overview["groups"][number]>(
					`SELECT tool,signature,${weight} count,MAX(${time}) lastSeen FROM ${source} ${where([...conditions, `outcome IN ${issues}`])} GROUP BY tool,signature ORDER BY count DESC,lastSeen DESC LIMIT 30`,
				)
				.all(values),
			daily: db
				.prepare<Record<string, string | number>, Overview["daily"][number]>(
					`SELECT ${day} day,${counts} FROM ${source} ${clause} GROUP BY day ORDER BY day DESC LIMIT 90`,
				)
				.all(values),
		};
	}

	function calls(params: URLSearchParams): CallPage {
		const { conditions, values } = filters(params);
		const outcome = params.get("outcome") || "issues";
		if (outcome === "issues") conditions.push(`outcome IN ${issues}`);
		else if (outcome !== "all") {
			if (
				![
					"ok",
					"error",
					"nonzero",
					"cancelled",
					"blocked",
					"pending",
					"unknown",
				].includes(outcome)
			)
				throw new BadRequest("Invalid outcome");
			conditions.push("outcome=@outcome");
			values["outcome"] = outcome;
		}
		const cursor = integer(params.get("cursor"), 0, Number.MAX_SAFE_INTEGER);
		if (cursor) {
			conditions.push(
				"(timestamp<(SELECT timestamp FROM calls WHERE id=@cursor) OR (timestamp=(SELECT timestamp FROM calls WHERE id=@cursor) AND id<@cursor))",
			);
			values["cursor"] = cursor;
		}
		const limit = integer(params.get("limit"), 50, 100);
		const rows = db
			.prepare<Record<string, string | number>, CallRow>(
				`SELECT ${columns} FROM calls ${where(conditions)} ORDER BY timestamp DESC,id DESC LIMIT ${limit + 1}`,
			)
			.all(values);
		const more = rows.length > limit;
		if (more) rows.pop();
		return { rows, nextCursor: more ? (rows.at(-1)?.id ?? null) : null };
	}

	function detail(id: number): CallDetail | null {
		const call = db
			.prepare<[number], CallRow>(`SELECT ${columns} FROM calls WHERE id=?`)
			.get(id);
		if (!call) return null;
		const stored = db
			.prepare<
				[number],
				{
					arguments: string;
					result: string;
					path: string;
					line: number;
					sessionId: string;
					callId: string;
					parentCallId: string | null;
					fileId: number;
					unpaired: number;
				}
			>(`SELECT p.arguments,p.result,f.path,c.line,f.session_id sessionId,c.call_id callId,
			parent.call_id parentCallId,c.file_id fileId,c.unpaired FROM calls c
			JOIN payloads p ON p.call_id=c.id JOIN files f ON f.id=c.file_id
			LEFT JOIN calls parent ON parent.id=c.parent_call_id WHERE c.id=?`)
			.get(id);
		if (!stored) throw new Error("Call detail is missing");
		const context = db
			.prepare<[number, number, number], CallDetail["context"][number]>(`
			SELECT f.line,e.role,e.timestamp,e.text FROM file_entries f JOIN entries e ON e.key=f.entry_key
			WHERE f.file_id=? AND f.line BETWEEN ? AND ? ORDER BY f.line
		`)
			.all(stored.fileId, Math.max(1, stored.line - 4), stored.line + 4);
		return {
			call,
			arguments: stored.arguments,
			result: stored.result,
			path: stored.path,
			line: stored.line,
			sessionId: stored.sessionId,
			callId: stored.callId,
			parentCallId: stored.parentCallId,
			context,
			notes: [
				"Provider and model come from the initiating assistant message. Model aliases are not verified backend snapshots. Pi and extension versions are not reliably recorded in these sessions.",
				"Neighbouring entries are file chronology, not proof of recovery or the active conversation branch. Context is limited to 32,768 characters per entry.",
				"Binary content is omitted. Indexed strings are limited to 131,072 characters and each detail to 524,288 characters. Source traces may already be truncated.",
				...(stored.unpaired
					? [
							"No matching initiating call was found for this result. Model attribution is unknown.",
						]
					: []),
				...(call.scope === "nested"
					? [
							"Nested snapshots are deduplicated across exec/wait results. Their timestamp is the initiating cell time, not a measured nested execution time.",
						]
					: []),
			],
		};
	}

	function sessions(params: URLSearchParams): SessionPage {
		const query = params.get("q")?.trim() ?? "";
		if (query.length > 512)
			throw new BadRequest("Session search is limited to 512 characters");
		const pattern = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
		const rows = db
			.prepare<[string, string], SessionPage["sessions"][number]>(`
			SELECT session_id id,project,strftime('%Y-%m-%dT%H:%M:%fZ',MAX(mtime)/1000,'unixepoch') updatedAt
			FROM files WHERE session_id<>'unknown' AND (session_id LIKE ? ESCAPE '\\' OR project LIKE ? ESCAPE '\\')
			GROUP BY session_id ORDER BY MAX(mtime) DESC LIMIT 51
		`)
			.all(pattern, pattern);
		const hasMore = rows.length > 50;
		if (hasMore) rows.pop();
		return { sessions: rows, hasMore };
	}

	function facets(): Facets {
		return {
			models: db
				.prepare<[], Facets["models"][number]>(
					"SELECT DISTINCT provider,model FROM tallies ORDER BY provider,model",
				)
				.all(),
			tools: db
				.prepare<[], { tool: string }>(
					"SELECT DISTINCT tool FROM tallies ORDER BY tool",
				)
				.all()
				.map((row) => row.tool),
			projects: db
				.prepare<[], { project: string }>(
					"SELECT DISTINCT project FROM files ORDER BY project",
				)
				.all()
				.map((row) => row.project),
		};
	}

	function status(): IndexStatus {
		const meta = Object.fromEntries(
			db
				.prepare<[], { key: string; value: string }>("SELECT * FROM metadata")
				.all()
				.map((row) => [row.key, row.value]),
		);
		const progress = object(JSON.parse(meta["indexStatus"] ?? "{}"));
		const totals = db
			.prepare<[], { files: number; malformed: number }>(
				"SELECT COUNT(*) files,COALESCE(SUM(malformed),0) malformed FROM files",
			)
			.get();
		const coverage = db
			.prepare<
				[],
				{
					unpairedResults: number;
					wrappersWithoutTraces: number;
					droppedTraces: number;
				}
			>(
				`SELECT unpaired unpairedResults,missing wrappersWithoutTraces,dropped droppedTraces FROM coverage WHERE id=1`,
			)
			.get();
		const phase = string(progress["phase"]);
		return {
			phase:
				phase === "idle" || phase === "error" || phase === "indexing"
					? phase
					: "starting",
			revision: Number(meta["revision"] ?? 0),
			files: totals?.files ?? 0,
			entries: Number(meta["entries"] ?? 0),
			bytesRead:
				typeof progress["bytesRead"] === "number" ? progress["bytesRead"] : 0,
			lastScan: string(progress["lastScan"]) || null,
			error: string(progress["error"]) || null,
			issues: db
				.prepare<[], { path: string; message: string }>(
					"SELECT path,issue message FROM files WHERE issue IS NOT NULL ORDER BY id DESC LIMIT 20",
				)
				.all(),
			coverage: {
				malformedLines: totals?.malformed ?? 0,
				unpairedResults: coverage?.unpairedResults ?? 0,
				wrappersWithoutTraces: coverage?.wrappersWithoutTraces ?? 0,
				droppedTraces: coverage?.droppedTraces ?? 0,
			},
		};
	}

	return function query(path: string, params: URLSearchParams): unknown {
		// One SQLite read snapshot per response, even while the index writer commits batches.
		return db.transaction(() => {
			if (path === "/api/status") return status();
			if (path === "/api/sessions") return sessions(params);
			if (path === "/api/facets") return facets();
			if (path === "/api/overview") return overview(params);
			if (path === "/api/calls") return calls(params);
			const match = /^\/api\/calls\/(\d+)$/.exec(path);
			if (match)
				return detail(integer(match[1] ?? null, 0, Number.MAX_SAFE_INTEGER));
			return null;
		})();
	};
}
