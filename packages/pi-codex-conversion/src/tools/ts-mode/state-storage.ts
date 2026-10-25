import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { acquireDirectoryLock } from "../notebook-mode/directory-lock.ts";
import { compactState, emptyState, mergeState, type PortableState } from "./portable-state.ts";

export class TsStateStorage {
	readonly directory: string;
	readonly projectDirectory: string;
	private readonly profilesDirectory: string;
	private readonly maxBytes: number;
	constructor(agentDir: string, cwd: string, sessionId: string, maxBytes: number) {
		this.maxBytes = maxBytes;
		const projectKey = createHash("sha256").update(cwd).digest("hex");
		this.projectDirectory = join(agentDir, "ts-state", "projects", projectKey);
		this.directory = join(this.projectDirectory, "sessions", createHash("sha256").update(sessionId).digest("hex"));
		this.profilesDirectory = join(agentDir, "ts-state", "profiles");
	}
	async read(name = "committed"): Promise<PortableState> {
		const state = await this.readPath(this.path(this.directory, name));
		if (state) return state;
		if (name === "committed") return emptyState();
		throw new Error(`No TS snapshot ${name}; inspect saved candidates before loading`);
	}
	async initial(): Promise<{ state: PortableState; observedProject: PortableState }> {
		const project = await this.readPath(this.path(this.projectDirectory, "committed")) ?? emptyState();
		return { state: await this.readPath(this.path(this.directory, "committed")) ?? project,
			observedProject: await this.readPath(this.path(this.directory, "observed-project")) ?? project };
	}
	async readProfile(name: string): Promise<PortableState> {
		const state = await this.readPath(this.path(this.profilesDirectory, name));
		if (!state) throw new Error(`No saved TS profile ${name}; save a TS profile first. Deno Notebook profiles are separate.`);
		return state;
	}
	async readProject(): Promise<PortableState> { return await this.readPath(this.path(this.projectDirectory, "committed")) ?? emptyState(); }
	async writeProfile(name: string, state: PortableState): Promise<void> {
		if (name.startsWith("candidate-")) throw new Error("TS profile names starting with candidate- are reserved for recovery snapshots; choose another name");
		await this.writePath(this.profilesDirectory, name, state);
	}
	async list(): Promise<{ profiles: string[]; candidates: string[] }> {
		const names = async (directory: string): Promise<string[]> => {
			try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]{1,100}\.bin$/.test(entry.name)).map(entry => entry.name.slice(0, -4)).sort(); }
			catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
		};
		return { profiles: await names(this.profilesDirectory), candidates: (await names(this.directory)).filter(name => name.startsWith("candidate-")) };
	}
	async mergeProject(observed: PortableState, candidate: PortableState): Promise<{ state: PortableState; conflicts: string[] }> {
		await mkdir(this.projectDirectory, { recursive: true, mode: 0o700 });
		const lock = await acquireDirectoryLock(join(this.projectDirectory, ".write-lock"), { waitMs: 5000, staleMs: 30000, pollMs: 25 });
		if (!lock) throw new Error("TS project pins are busy; retry checkpoint");
		try {
			const current = await this.readPath(this.path(this.projectDirectory, "committed")) ?? emptyState();
			const result = mergeState(observed, current, candidate);
			if (!result.conflicts.length) await this.atomicWrite(this.projectDirectory, "committed", compactState(result.state));
			return result;
		} finally { lock.release(); }
	}
	private async readPath(path: string): Promise<PortableState | undefined> {
		try {
			const bytes = await readFile(path);
			if (bytes.length > this.maxBytes) throw new Error("TS state exceeds the session storage budget; reset it or increase the heap budget");
			const value: unknown = deserialize(bytes);
			assertPortableState(value);
			return value;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw error;
		}
	}
	async write(state: PortableState, name = "committed"): Promise<void> {
		await this.writePath(this.directory, name, state);
	}
	private async writePath(directory: string, name: string, state: PortableState): Promise<void> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const lock = await acquireDirectoryLock(join(directory, ".write-lock"), { waitMs: 5000, staleMs: 30000, pollMs: 25 });
		if (!lock) throw new Error("TS state storage is busy; retry saving");
		try { await this.atomicWrite(directory, name, state); }
		finally { lock.release(); }
	}
	private async atomicWrite(directory: string, name: string, state: PortableState): Promise<void> {
		const path = this.path(directory, name);
		const bytes = serialize(state);
		if (bytes.length > this.maxBytes) throw new Error("TS state exceeds the session storage budget; release large bindings before retrying");
		const temporary = join(directory, `.pending-${randomUUID()}`);
		try {
			await writeFile(temporary, bytes, { mode: 0o600 });
			await rename(temporary, path);
		} finally { await unlink(temporary).catch(error => { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }); }
	}
	private path(directory: string, name: string): string {
		if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name)) throw new Error("TS save names must contain 1–100 letters, numbers, underscores or hyphens");
		return join(directory, `${name}.bin`);
	}
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function assertPortableState(value: unknown): asserts value is PortableState {
	if (!record(value) || value["version"] !== 1 || !record(value["roots"]) || !record(value["nodes"]) || !record(value["bindings"]) || !Array.isArray(value["pins"]) || !value["pins"].every(item => typeof item === "string") || !Array.isArray(value["imports"]) || !value["imports"].every(item => typeof item === "string")) throw new Error("Invalid TS state; use notebook reset to start clean");
	const roots = value["roots"];
	const nodes = value["nodes"];
	const bindings = value["bindings"];
	const isValue = (item: unknown): boolean => item === null || item === undefined || ["string", "number", "boolean", "bigint"].includes(typeof item) || (record(item) && typeof item["ref"] === "string" && Object.hasOwn(nodes, item["ref"]));
	for (const [name, binding] of Object.entries(value["bindings"])) {
		if (!/^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u.test(name) || !record(binding) || binding["name"] !== name || !["let", "const", "function", "class", "enum", "namespace", "type", "import"].includes(String(binding["kind"])) || typeof binding["declaration"] !== "string" || (binding["source"] !== undefined && typeof binding["source"] !== "string")) throw new Error(`Invalid TS binding ${name}`);
		if (binding["references"] !== undefined && (!Array.isArray(binding["references"]) || !binding["references"].every(item => typeof item === "string"))) throw new Error(`Invalid TS references for ${name}`);
		if (binding["checkpoint"] !== undefined && (!record(binding["checkpoint"]) || ![binding["checkpoint"]["snapshot"], binding["checkpoint"]["restore"]].every(helper => typeof helper === "string" && Object.hasOwn(bindings, helper)))) throw new Error(`Invalid TS checkpoint helpers for ${name}`);
		if (binding["hook"] !== undefined && (!["startup", "tool_result"].includes(String(binding["hook"])) || binding["kind"] !== "function" || !value["pins"].includes(name))) throw new Error(`Invalid TS hook ${name}; hooks require pinned functions`);
		if (binding["module"] !== undefined && (!record(binding["module"]) || typeof binding["module"]["specifier"] !== "string" || typeof binding["module"]["imported"] !== "string")) throw new Error(`Invalid TS module recipe ${name}`);
	}
	if (!Object.values(roots).every(isValue)) throw new Error("Invalid TS root reference");
	for (const node of Object.values(nodes)) {
		if (!record(node)) throw new Error("Invalid TS graph node");
		switch (node["kind"]) {
			case "checkpoint": if (![node["snapshot"], node["restore"]].every(helper => typeof helper === "string" && Object.hasOwn(bindings, helper)) || !isValue(node["data"])) throw new Error("Invalid TS checkpoint node"); break;
			case "recipe": if (typeof node["name"] !== "string" || !Object.hasOwn(value["bindings"], node["name"]) || !record(node["properties"]) || !Object.values(node["properties"]).every(isValue)) throw new Error("Invalid TS recipe"); break;
			case "module": if (typeof node["specifier"] !== "string" || typeof node["imported"] !== "string" || (node["attributes"] !== undefined && (!record(node["attributes"]) || !Object.values(node["attributes"]).every(item => typeof item === "string")))) throw new Error("Invalid TS module recipe"); break;
			case "binary": if (!(node["bytes"] instanceof Uint8Array)) throw new Error("Invalid TS binary value"); break;
			case "date": if (typeof node["time"] !== "number") throw new Error("Invalid TS date"); break;
			case "regexp": if (typeof node["source"] !== "string" || typeof node["flags"] !== "string" || typeof node["lastIndex"] !== "number") throw new Error("Invalid TS regexp"); break;
			case "view": if (typeof node["constructor"] !== "string" || !isValue(node["buffer"]) || !Number.isSafeInteger(node["byteOffset"]) || !Number.isSafeInteger(node["length"])) throw new Error("Invalid TS typed array"); break;
			case "object": case "array":
				if (!record(node["properties"]) || !Object.values(node["properties"]).every(isValue) || (node["kind"] === "array" && (!Number.isSafeInteger(node["length"]) || Number(node["length"]) < 0)) || (node["kind"] === "object" && typeof node["nullPrototype"] !== "boolean")) throw new Error("Invalid TS object node"); break;
			case "map": if (!Array.isArray(node["entries"]) || !node["entries"].every(entry => Array.isArray(entry) && entry.length === 2 && entry.every(isValue))) throw new Error("Invalid TS map"); break;
			case "set": if (!Array.isArray(node["entries"]) || !node["entries"].every(isValue)) throw new Error("Invalid TS set"); break;
			default: throw new Error("Unknown TS graph node");
		}
	}
}
