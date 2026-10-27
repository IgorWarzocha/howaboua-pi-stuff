import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { assertProfileName } from "../notebook-mode/profile-state-format.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { JS_PRELUDE } from "./prelude.ts";
import { isJsInventory, validJsBindingName } from "./bindings.ts";
import { assertJsData } from "./data-state.ts";
import { resolveNotebookProject } from "../notebook-mode/project-identity.ts";
import { withProjectStateLock } from "../notebook-mode/project-state-lock.ts";
import { JS_BINDINGS_SOURCE } from "./managed-bindings.ts";
import { JS_SUPPORT_SOURCE } from "./support.ts";
import type { JsSnapshot } from "./protocol.ts";

// Snapshots are engine memory, not a portable interchange format. Never restore
// an image with a different bridge or engine build, even if its file format parses.
// 3.6.3 changes only host promise cleanup; its WASM is byte-identical to 3.6.2.
// Keep the engine fingerprint so existing checkpoints remain compatible.
const FINGERPRINT = createHash("sha256").update("js-notebook-v1/quickjs-wasi@3.6.2\0").update(JS_PRELUDE).digest();
const SUPPORT_FINGERPRINT = createHash("sha256").update(FINGERPRINT).update("js-notebook-support-v1\0").update(JS_SUPPORT_SOURCE).digest();
const BINDINGS_FINGERPRINT = createHash("sha256").update(SUPPORT_FINGERPRINT).update(JS_BINDINGS_SOURCE).digest();
const HEADER_BYTES = 44;
const MAX_INVENTORY_BYTES = 1024 * 1024;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export class JsStateStorage {
	private readonly root: string;
	private readonly session: string;
	private readonly legacySession: string;
	private readonly maxBytes: number;
	private observed: { snapshot: WeakRef<JsSnapshot>; identity: BigIntStats } | undefined;
	constructor(agentDir: string, cwd: string, identity: string, maxBytes: number) {
		this.root = join(agentDir, "cache", "pi-codex-conversion", "js-notebook");
		this.legacySession = join(this.root, "sessions", hash(JSON.stringify([cwd, identity])) + ".bin");
		this.session = join(this.root, "projects", hash(resolveNotebookProject(cwd)), "notebook.bin");
		this.maxBytes = maxBytes;
	}
	async withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		await mkdir(dirname(this.session), { recursive: true, mode: 0o700 });
		try { return await withProjectStateLock(this.session + ".lock", operation, signal); }
		catch (error) {
			if (error instanceof Error && error.message.startsWith("timed out waiting for lock:")) throw new Error("Another conversation is using this project notebook; wait for its cell to finish or cancel it, then retry");
			throw error;
		}
	}
	async migrateLegacy(): Promise<boolean> {
		if (await this.read()) return false;
		const legacy = await this.readPath(this.legacySession);
		if (!legacy) return false;
		await this.write(legacy); return true;
	}
	async read(name?: string, previous?: JsSnapshot): Promise<JsSnapshot | undefined> { return this.readPath(this.path(name), name, previous); }
	private async readPath(path: string, name?: string, previous?: JsSnapshot): Promise<JsSnapshot | undefined> {
		try {
			const file = await open(path, "r");
			try {
				const identity = await file.stat({ bigint: true });
				if (identity.size > BigInt(this.maxBytes + HEADER_BYTES + MAX_INVENTORY_BYTES)) throw new Error("Saved JS Notebook exceeds the memory budget; increase the Notebook heap setting");
				// Match both the validated image and full file identity. Rename writers
				// replace the inode; in-place edits also invalidate nanosecond ctime.
				if (path === this.session && previous && this.observed?.snapshot.deref() === previous && sameFile(this.observed.identity, identity)) return previous;
				const snapshot = this.decode(await file.readFile());
				if (path === this.session) this.observed = { snapshot: new WeakRef(snapshot), identity };
				return snapshot;
			} finally { await file.close(); }
		} catch (error) {
			if (isMissing(error)) { if (name) throw new Error(`JS Notebook profile not found: ${name}`); return undefined; }
			throw error;
		}
	}
	private decode(bytes: Buffer): JsSnapshot {
		const version = bytes.toString("ascii", 0, 4);
		if (bytes.length < 40 || !["JSN1", "JSN2", "JSN3", "JSN4", "JSN5"].includes(version) || !bytes.subarray(4, 36).equals(version === "JSN5" ? BINDINGS_FINGERPRINT : (version === "JSN3" || version === "JSN4") ? SUPPORT_FINGERPRINT : FINGERPRINT)) throw new Error("This JS Notebook checkpoint uses a different runtime version; use the matching package version to recover it, or explicitly reset this project notebook");
		const controller = bytes.readUInt32LE(36);
		const metadataBytes = version !== "JSN1" && bytes.length >= HEADER_BYTES ? bytes.readUInt32LE(40) : 0;
		const offset = (version !== "JSN1" ? HEADER_BYTES : 40) + metadataBytes;
		if (((version === "JSN4" || version === "JSN5") ? bytes.length - HEADER_BYTES > this.maxBytes : metadataBytes > MAX_INVENTORY_BYTES) || offset > bytes.length || !controller || controller >= bytes.length - offset || bytes.length - offset > this.maxBytes) throw new Error("The JS Notebook checkpoint is invalid; it was not loaded");
		if (version === "JSN1") return { bytes: bytes.subarray(offset), controller };
		const metadata: unknown = (version === "JSN4" || version === "JSN5") ? deserialize(bytes.subarray(HEADER_BYTES, offset)) : JSON.parse(bytes.toString("utf8", HEADER_BYTES, offset));
		if (version === "JSN4" || version === "JSN5") return { bytes: bytes.subarray(offset), controller, ...validateMetadata(metadata, bytes.length - offset) };
		if (version === "JSN3") {
			if (!metadata || typeof metadata !== "object" || !("support" in metadata) || !Number.isSafeInteger(metadata.support) || typeof metadata.support !== "number" || metadata.support <= 0 || metadata.support >= bytes.length - offset || !("inventory" in metadata) || !isJsInventory(metadata.inventory)) throw new Error("The saved JS Notebook support metadata is invalid; the checkpoint was not loaded");
			return { bytes: bytes.subarray(offset), controller, inventory: metadata.inventory, support: metadata.support };
		}
		const inventory = metadata;
		if (!isJsInventory(inventory)) throw new Error("The saved JS Notebook binding inventory is invalid; the checkpoint was not loaded");
		return { bytes: bytes.subarray(offset), controller, inventory };
	}
	async write(snapshot: JsSnapshot, name?: string): Promise<void> {
		if (snapshot.bytes.length > this.maxBytes) throw new Error("JS Notebook checkpoint exceeds the memory budget; reduce retained data or increase the Notebook heap setting");
		if (name === undefined) snapshot.projectRevision = randomUUID();
		if (!snapshot.inventory) snapshot.inventory = { declarations: [], baseline: [], complete: false };
		const metadata = serialize(validateMetadata({ inventory: snapshot.inventory, support: snapshot.support, pins: snapshot.pins, observedProject: snapshot.observedProject, bindings: snapshot.bindings, projectRevision: snapshot.projectRevision }, snapshot.bytes.length));
		if (metadata.length + snapshot.bytes.length > this.maxBytes) throw new Error("JS Notebook checkpoint exceeds the memory budget; reduce retained data or increase the Notebook heap setting");
		const header = Buffer.alloc(HEADER_BYTES);
		header.write(snapshot.bindings !== undefined ? "JSN5" : "JSN4");
		(snapshot.bindings !== undefined ? BINDINGS_FINGERPRINT : SUPPORT_FINGERPRINT).copy(header, 4);
		header.writeUInt32LE(snapshot.controller, 36);
		header.writeUInt32LE(metadata.length, 40);
		const path = this.path(name), temporary = `${path}.${randomUUID()}.tmp`;
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		try {
			const file = await open(temporary, "wx", 0o600);
			try {
				await file.writeFile([header, metadata, snapshot.bytes]);
				await rename(temporary, path);
				if (name === undefined) this.observed = { snapshot: new WeakRef(snapshot), identity: await file.stat({ bigint: true }) };
			} finally { await file.close(); }
		}
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
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
	return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** Only durable fields cross the envelope; startup status belongs to a management clone. */
function validateMetadata(value: unknown, imageBytes: number): Pick<JsSnapshot, "inventory" | "support" | "pins" | "observedProject" | "bindings" | "projectRevision"> {
	const invalid = (): never => { throw new Error("The saved JS Notebook metadata is invalid; the checkpoint was not loaded"); };
	if (!value || typeof value !== "object") return invalid();
	if (!("inventory" in value) || !isJsInventory(value.inventory)) return invalid();
	const result: Pick<JsSnapshot, "inventory" | "support" | "pins" | "observedProject" | "bindings" | "projectRevision"> = { inventory: value.inventory };
	if ("support" in value && value.support !== undefined) {
		if (typeof value.support !== "number" || !Number.isSafeInteger(value.support) || value.support <= 0 || value.support >= imageBytes) return invalid();
		result.support = value.support;
	}
	if ("bindings" in value && value.bindings !== undefined) {
		if (typeof value.bindings !== "number" || !Number.isSafeInteger(value.bindings) || value.bindings <= 0 || value.bindings >= imageBytes) return invalid();
		result.bindings = value.bindings;
	}
	if ("projectRevision" in value && value.projectRevision !== undefined) {
		if (typeof value.projectRevision !== "string" || !/^[a-f0-9-]{36}$/.test(value.projectRevision)) return invalid();
		result.projectRevision = value.projectRevision;
	}
	if ("pins" in value && value.pins !== undefined) {
		if (!Array.isArray(value.pins) || !value.pins.every(name => typeof name === "string" && validJsBindingName(name)) || new Set(value.pins).size !== value.pins.length) return invalid();
		// Inventories do not enumerate user-added globals, including legacy images.
		result.pins = value.pins;
	}
	if ("observedProject" in value && value.observedProject !== undefined) {
		const project = value.observedProject;
		if (!project || typeof project !== "object" || !("key" in project) || typeof project.key !== "string" || !/^[a-f0-9]{64}$/.test(project.key) || !("state" in project)) return invalid();
		assertJsData(project.state);
		if (new Set(project.state.pins).size !== project.state.pins.length) return invalid();
		result.observedProject = { key: project.key, state: project.state };
	}
	return result;
}
