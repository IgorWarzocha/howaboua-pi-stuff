import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { assertProfileName } from "../notebook-mode/profile-state-format.ts";
import { globMatcher } from "../notebook-mode/glob.ts";
import { JS_PRELUDE } from "./prelude.ts";
import { isJsInventory, validJsBindingName } from "./bindings.ts";
import { assertJsData } from "./data-state.ts";
import { JS_SUPPORT_SOURCE } from "./support.ts";
import type { JsSnapshot } from "./protocol.ts";

// Snapshots are engine memory, not a portable interchange format. Never restore
// an image with a different bridge or engine build, even if its file format parses.
const FINGERPRINT = createHash("sha256").update("js-notebook-v1/quickjs-wasi@3.6.2\0").update(JS_PRELUDE).digest();
const SUPPORT_FINGERPRINT = createHash("sha256").update(FINGERPRINT).update("js-notebook-support-v1\0").update(JS_SUPPORT_SOURCE).digest();
const HEADER_BYTES = 44;
const MAX_INVENTORY_BYTES = 1024 * 1024;
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
			if ((await stat(path)).size > this.maxBytes + HEADER_BYTES + MAX_INVENTORY_BYTES) throw new Error("Saved JS Notebook exceeds the memory budget; increase the Notebook heap setting");
			const bytes = await readFile(path);
			const version = bytes.toString("ascii", 0, 4);
			if (bytes.length < 40 || !["JSN1", "JSN2", "JSN3", "JSN4"].includes(version) || !bytes.subarray(4, 36).equals((version === "JSN3" || version === "JSN4") ? SUPPORT_FINGERPRINT : FINGERPRINT)) throw new Error("This JS Notebook checkpoint uses a different runtime version; use the matching package version to recover it, or explicitly reset this session");
			const controller = bytes.readUInt32LE(36);
			const metadataBytes = version !== "JSN1" && bytes.length >= HEADER_BYTES ? bytes.readUInt32LE(40) : 0;
			const offset = (version !== "JSN1" ? HEADER_BYTES : 40) + metadataBytes;
			if ((version === "JSN4" ? bytes.length - HEADER_BYTES > this.maxBytes : metadataBytes > MAX_INVENTORY_BYTES) || offset > bytes.length || !controller || controller >= bytes.length - offset || bytes.length - offset > this.maxBytes) throw new Error("The JS Notebook checkpoint is invalid; it was not loaded");
			if (version === "JSN1") return { bytes: bytes.subarray(offset), controller };
			const metadata: unknown = version === "JSN4" ? deserialize(bytes.subarray(HEADER_BYTES, offset)) : JSON.parse(bytes.toString("utf8", HEADER_BYTES, offset));
			if (version === "JSN4") return { bytes: bytes.subarray(offset), controller, ...validateMetadata(metadata, bytes.length - offset) };
			if (version === "JSN3") {
				if (!metadata || typeof metadata !== "object" || !("support" in metadata) || !Number.isSafeInteger(metadata.support) || typeof metadata.support !== "number" || metadata.support <= 0 || metadata.support >= bytes.length - offset || !("inventory" in metadata) || !isJsInventory(metadata.inventory)) throw new Error("The saved JS Notebook support metadata is invalid; the checkpoint was not loaded");
				return { bytes: bytes.subarray(offset), controller, inventory: metadata.inventory, support: metadata.support };
			}
			const inventory = metadata;
			if (!isJsInventory(inventory)) throw new Error("The saved JS Notebook binding inventory is invalid; the checkpoint was not loaded");
			return { bytes: bytes.subarray(offset), controller, inventory };
		} catch (error) {
			if (isMissing(error)) { if (name) throw new Error(`JS Notebook profile not found: ${name}`); return undefined; }
			throw error;
		}
	}
	async write(snapshot: JsSnapshot, name?: string): Promise<void> {
		if (snapshot.bytes.length > this.maxBytes) throw new Error("JS Notebook checkpoint exceeds the memory budget; reduce retained data or increase the Notebook heap setting");
		const modern = snapshot.inventory !== undefined || snapshot.support !== undefined || snapshot.pins !== undefined || snapshot.observedProject !== undefined;
		const metadata = modern ? serialize(validateMetadata({ inventory: snapshot.inventory, support: snapshot.support, pins: snapshot.pins, observedProject: snapshot.observedProject }, snapshot.bytes.length)) : Buffer.alloc(0);
		if (metadata.length + snapshot.bytes.length > this.maxBytes) throw new Error("JS Notebook checkpoint exceeds the memory budget; reduce retained data or increase the Notebook heap setting");
		const header = Buffer.alloc(modern ? HEADER_BYTES : 40);
		header.write(modern ? "JSN4" : "JSN1");
		(modern ? SUPPORT_FINGERPRINT : FINGERPRINT).copy(header, 4);
		header.writeUInt32LE(snapshot.controller, 36);
		if (modern) header.writeUInt32LE(metadata.length, 40);
		const path = this.path(name), temporary = `${path}.${randomUUID()}.tmp`;
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		try { await writeFile(temporary, [header, metadata, snapshot.bytes], { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
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

/** Only durable fields cross the envelope; startup status belongs to a management clone. */
function validateMetadata(value: unknown, imageBytes: number): Pick<JsSnapshot, "inventory" | "support" | "pins" | "observedProject"> {
	const invalid = (): never => { throw new Error("The saved JS Notebook metadata is invalid; the checkpoint was not loaded"); };
	if (!value || typeof value !== "object") return invalid();
	if (!("inventory" in value) || !isJsInventory(value.inventory)) return invalid();
	const result: Pick<JsSnapshot, "inventory" | "support" | "pins" | "observedProject"> = { inventory: value.inventory };
	if ("support" in value && value.support !== undefined) {
		if (typeof value.support !== "number" || !Number.isSafeInteger(value.support) || value.support <= 0 || value.support >= imageBytes) return invalid();
		result.support = value.support;
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
