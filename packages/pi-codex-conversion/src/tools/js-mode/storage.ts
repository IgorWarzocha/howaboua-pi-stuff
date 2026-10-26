import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertProfileName } from "../notebook-mode/profile-state-format.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { JS_PRELUDE } from "./prelude.ts";
import type { JsSnapshot } from "./protocol.ts";

// Snapshots are engine memory, not a portable interchange format. Never restore
// an image with a different bridge or engine build, even if its file format parses.
const FINGERPRINT = createHash("sha256").update("js-notebook-v1/quickjs-wasi@3.6.2\0").update(JS_PRELUDE).digest();
const HEADER_BYTES = 40;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export class JsStateStorage {
	private readonly root: string;
	private readonly session: string;
	private readonly maxBytes: number;
	constructor(agentDir: string, cwd: string, identity: string, maxBytes: number) {
		this.root = join(agentDir, "cache", "pi-codex-conversion", "js-notebook");
		this.session = join(this.root, "sessions", hash(JSON.stringify([cwd, identity])) + ".bin");
		this.maxBytes = maxBytes;
	}
	async read(name?: string): Promise<JsSnapshot | undefined> {
		const path = this.path(name);
		try {
			if ((await stat(path)).size > this.maxBytes + HEADER_BYTES) throw new Error("Saved JS Notebook exceeds the memory budget; increase the Notebook heap setting");
			const bytes = await readFile(path);
			if (bytes.length < HEADER_BYTES || bytes.toString("ascii", 0, 4) !== "JSN1" || !bytes.subarray(4, 36).equals(FINGERPRINT)) throw new Error("This JS Notebook checkpoint uses a different runtime version; use the matching package version to recover it, or explicitly reset this session");
			const controller = bytes.readUInt32LE(36);
			if (!controller || controller >= bytes.length - HEADER_BYTES) throw new Error("The JS Notebook checkpoint is invalid; it was not loaded");
			return { bytes: bytes.subarray(HEADER_BYTES), controller };
		} catch (error) {
			if (isMissing(error)) { if (name) throw new Error(`JS Notebook profile not found: ${name}`); return undefined; }
			throw error;
		}
	}
	async write(snapshot: JsSnapshot, name?: string): Promise<void> {
		if (snapshot.bytes.length > this.maxBytes) throw new Error("JS Notebook checkpoint exceeds the memory budget; reduce retained data or increase the Notebook heap setting");
		const path = this.path(name), temporary = `${path}.${randomUUID()}.tmp`;
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const header = Buffer.alloc(HEADER_BYTES);
		header.write("JSN1"); FINGERPRINT.copy(header, 4); header.writeUInt32LE(snapshot.controller, 36);
		try { await writeFile(temporary, [header, snapshot.bytes], { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
		finally { await rm(temporary, { force: true }); }
	}
	async reset(): Promise<void> { await rm(this.session, { force: true }); }
	async list(query = "*"): Promise<string[]> {
		try { return (await readdir(join(this.root, "profiles"))).filter(name => name.endsWith(".bin")).map(name => name.slice(0, -4)).filter(globMatcher(query)).sort(); }
		catch (error) { if (isMissing(error)) return []; throw error; }
	}
	private path(name?: string): string { if (name === undefined) return this.session; assertProfileName(name); return join(this.root, "profiles", name + ".bin"); }
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
