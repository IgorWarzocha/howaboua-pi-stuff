import { posix } from "node:path";
import type Database from "better-sqlite3";
import type { Outcome } from "./contracts.ts";
import { detectFileReads } from "./file-reads.ts";
import { hash, type JsonObject, object, textContent } from "./normalise.ts";

export interface CachedFileCall {
	id: number;
	tool: string;
	project: string;
	timestamp: string;
	arguments: string;
}

interface SkillSource {
	path: string;
	directory: string;
	name: string;
}

/** Only recorded paths are used. Never inspect today's filesystem to rewrite historical evidence. */
export function createSkillFileIngestor(db: Database.Database) {
	const putSource =
		db.prepare(`INSERT INTO skill_file_sources VALUES (@path,@directory,@name,@authoritative)
		ON CONFLICT(path) DO UPDATE SET name=excluded.name,authoritative=excluded.authoritative
		WHERE excluded.authoritative>skill_file_sources.authoritative`);
	const source = db.prepare<
		[string],
		SkillSource
	>(`SELECT * FROM skill_file_sources
		WHERE substr(?,1,length(directory)+1)=directory||'/' ORDER BY length(directory) DESC LIMIT 1`);
	const callInput = db.prepare<[number], CachedFileCall>(
		"SELECT c.id,c.tool,c.project,c.timestamp,p.arguments FROM calls c JOIN payloads p ON p.call_id=c.id WHERE c.id=?",
	);
	const payload = db.prepare<[number], { result: string }>(
		"SELECT result FROM payloads WHERE call_id=?",
	);
	const event = db.prepare(`INSERT OR IGNORE INTO usage_events
		VALUES (@key,NULL,@call,@timestamp,'skill',@name,@path,'','agent',@evidence)`);
	const gap = db.prepare("INSERT OR REPLACE INTO skill_file_gaps VALUES (?,?)");
	const clearGap = db.prepare("DELETE FROM skill_file_gaps WHERE call_id=?");
	const rename = db.prepare(
		"UPDATE usage_events SET name=? WHERE kind='skill' AND path=? AND evidence IN ('file_read','file_reference_read')",
	);
	const candidate = db.prepare(
		"INSERT OR IGNORE INTO skill_file_candidates VALUES (?,?)",
	);
	const clearCandidates = db.prepare(
		"DELETE FROM skill_file_candidates WHERE call_id=?",
	);
	const resolveCandidates = db.prepare(`INSERT OR IGNORE INTO skill_file_replay
		SELECT DISTINCT call_id FROM skill_file_candidates WHERE path>=? AND path<?`);

	function register(path: string, name = ""): SkillSource | undefined {
		path = posix.normalize(path.replaceAll("\\", "/"));
		if (posix.basename(path).toLowerCase() !== "skill.md") return undefined;
		const directory = posix.dirname(path);
		if (directory === "." || directory === "/") return undefined;
		const item = { path, directory, name: name || posix.basename(directory) };
		const changed = putSource.run({
			...item,
			authoritative: Number(Boolean(name)),
		});
		if (changed.changes && name) rename.run(name, path);
		if (changed.changes)
			resolveCandidates.run(`${directory}/`, `${directory}0`);
		return source.get(path);
	}

	function targets(call: CachedFileCall) {
		let args: unknown;
		try {
			args = JSON.parse(call.arguments);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			if (/skill/i.test(call.arguments)) gap.run(call.id, "unreadable");
			return undefined;
		}
		const reads = detectFileReads(call.tool, args, call.project);
		reads.unsupported &&= /skill/i.test(call.arguments);
		clearCandidates.run(call.id);
		// A multi-file read can establish a root and read its references in either operand order.
		for (const path of reads.paths) register(path);
		reads.paths = reads.paths.filter((path) => {
			if (posix.basename(path).toLowerCase() === "skill.md" || source.get(path))
				return true;
			candidate.run(call.id, path);
			if (/(?:^|\/)skills?\//i.test(path)) reads.unsupported = true;
			return false;
		});
		return reads;
	}

	function discover(call: CachedFileCall): void {
		// Discovery precedes replay so references can resolve even when imported before their body reads.
		if (!/skill\.md/i.test(call.arguments)) return;
		for (const path of targets(call)?.paths ?? []) register(path);
	}

	function observe(
		call: CachedFileCall,
		reads: NonNullable<ReturnType<typeof targets>>,
		result: JsonObject,
	): void {
		clearGap.run(call.id);
		if (reads.unsupported) gap.run(call.id, "unsupported");
		if (reads.shell && !shellFinished(result)) {
			gap.run(call.id, "unfinished");
			return;
		}
		for (const path of reads.paths) {
			const skill = register(path) ?? source.get(path);
			if (!skill) continue;
			event.run({
				key: `read:${call.id}:${hash(path)}`,
				call: call.id,
				timestamp: call.timestamp,
				name: skill.name,
				path: skill.path,
				evidence: path === skill.path ? "file_read" : "file_reference_read",
			});
		}
	}

	function record(id: number, outcome: Outcome, result: JsonObject): void {
		if (outcome !== "ok") return;
		const call = callInput.get(id);
		if (!call) return;
		const reads = targets(call);
		if (reads && (reads.paths.length || reads.unsupported))
			observe(call, reads, result);
	}

	function replay(call: CachedFileCall): void {
		const reads = targets(call);
		if (!reads || (!reads.paths.length && !reads.unsupported)) return;
		if (!reads.shell) {
			observe(call, reads, {});
			return;
		}
		let result: JsonObject;
		try {
			result = object(JSON.parse(payload.get(call.id)?.result || "{}"));
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			gap.run(call.id, "unreadable");
			return;
		}
		observe(call, reads, result);
	}
	return { register, discover, record, replay };
}

/** Process-start acknowledgements are not completed shell calls. Tool success alone can hide an exit code. */
function shellFinished(result: JsonObject): boolean {
	// Native receipts prove the tool returned, not that a subprocess completed successfully.
	if (result["nativeReceipt"] !== undefined) return false;
	const text = textContent(result["content"]);
	let envelope = result;
	if (text.trimStart().startsWith("{")) {
		try {
			envelope = { ...result, ...object(JSON.parse(text)) };
		} catch {
			// Plain output remains inferred invocation evidence, never a confirmed body receipt.
		}
	}
	const details = object(envelope["details"]);
	const structured = object(envelope["structuredContent"]);
	const exit =
		envelope["exit_code"] ??
		envelope["exitCode"] ??
		details["exit_code"] ??
		details["exitCode"] ??
		structured["exit_code"];
	if (typeof exit === "number") return exit === 0;
	if (
		envelope["session_id"] !== undefined ||
		envelope["process_id"] !== undefined
	)
		return false;
	if (
		/^(?:Session \d+ still running|Process running with session ID)/.test(text)
	)
		return false;
	const observed =
		/^(?:Exit code:|Process exited with code)\s*(-?\d+)(?:\r?\n|$)/m.exec(
			text.split("Output:")[0] || "",
		);
	return !observed || Number(observed[1]) === 0;
}
