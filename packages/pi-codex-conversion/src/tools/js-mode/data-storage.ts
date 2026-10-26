import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { assertProfileName } from "../notebook-mode/profile-state-format.ts";
import { resolveNotebookProject } from "../notebook-mode/project-identity.ts";
import { withProjectStateLock } from "../notebook-mode/project-state-lock.ts";
import { compactState, emptyState, mergeState, type PortableState } from "../ts-mode/portable-state.ts";
import { assertJsData } from "./data-state.ts";

const MAGIC = Buffer.from("JSD1");

/** JS-only files share the existing graph merge, not another mode's storage. */
export class JsDataStorage {
	readonly projectKey: string;
	private readonly project: string;
	private readonly profiles: string;
	private readonly maxBytes: number;
	constructor(agentDir: string, cwd: string, maxBytes: number) {
		this.maxBytes = maxBytes;
		const root = join(agentDir, "cache", "pi-codex-conversion", "js-notebook");
		this.projectKey = createHash("sha256").update(resolveNotebookProject(cwd)).digest("hex");
		this.project = join(root, "projects", this.projectKey, "committed.bin");
		this.profiles = join(root, "profiles");
	}
	async readProfile(name: string): Promise<PortableState | undefined> { return this.read(this.profile(name), true); }
	async writeProfile(name: string, state: PortableState): Promise<void> { await this.write(this.profile(name), state); }
	async readProject(): Promise<PortableState> { return await this.read(this.project) ?? emptyState(); }
	async mergeProject(observed: PortableState, candidate: PortableState): Promise<{ conflicts: string[]; recoveryProfile?: string }> {
		assertJsData(candidate);
		await mkdir(dirname(this.project), { recursive: true, mode: 0o700 });
		return withProjectStateLock(this.project + ".lock", async () => {
			const current = await this.readProject();
			const result = mergeState(observed, current, candidate);
			if (result.conflicts.length) {
				const recoveryProfile = `conflict-${randomUUID()}`;
				await this.writeProfile(recoveryProfile, candidate);
				return { conflicts: result.conflicts, recoveryProfile };
			}
			await this.write(this.project, compactState(result.state));
			return { conflicts: [] };
		});
	}
	private profile(name: string): string { assertProfileName(name); return join(this.profiles, `${name}.bin`); }
	private async read(path: string, allowSnapshot = false): Promise<PortableState | undefined> {
		try {
			if ((await stat(path)).size > this.maxBytes) throw new Error("Saved JS data exceeds the Notebook heap budget; increase it before loading");
			const bytes = await readFile(path);
			// Whole-VM profiles use the same names. The on-disk tag chooses the route.
			if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
				if (allowSnapshot) return undefined;
				throw new Error("Saved JS project data is invalid; it was not loaded");
			}
			const value: unknown = deserialize(bytes.subarray(MAGIC.length));
			assertJsData(value); return value;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw error;
		}
	}
	private async write(path: string, state: PortableState): Promise<void> {
		assertJsData(state);
		const bytes = serialize(state);
		if (bytes.length + MAGIC.length > this.maxBytes) throw new Error("Selected JS data exceeds the Notebook heap budget; save fewer bindings or increase the budget");
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try { await writeFile(temporary, [MAGIC, bytes], { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
		finally { await rm(temporary, { force: true }); }
	}
}
