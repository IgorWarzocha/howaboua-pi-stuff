import { randomUUID } from "node:crypto";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isMissing, type Repository } from "./definitions.js";

export interface PulseState {
	firstSeenAt: number;
	lastRunAt?: number;
	lastDueKey?: string;
	worker?: {
		owner: string;
		runner: string;
		workerId: string;
	};
	running?: { runId: string; startedAt: number; workerId?: string };
}
export class PulseStore {
	readonly repo: Repository;
	readonly owner: string;
	constructor(repo: Repository, owner: string) {
		this.repo = repo;
		this.owner = owner;
	}
	private directory(id: string) {
		return join(this.repo.stateRoot, id);
	}
	async claim(id: string): Promise<boolean> {
		await mkdir(this.directory(id), { recursive: true });
		const path = join(this.directory(id), "owner");
		try {
			await writeFile(path, this.owner, { flag: "wx" });
			return true;
		} catch (error) {
			if ((await readFile(path, "utf8")) !== this.owner)
				throw new Error(
					`${id} belongs to another main session. Resume that session; scheduling is not transferred automatically.`,
				);
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;
			return false;
		}
	}
	async owned(id: string): Promise<boolean> {
		try {
			return (
				(await readFile(join(this.directory(id), "owner"), "utf8")) ===
				this.owner
			);
		} catch (error) {
			if (isMissing(error)) return false;
			throw error;
		}
	}
	async ownedIds(): Promise<string[]> {
		let entries;
		try {
			entries = await readdir(this.repo.stateRoot, { withFileTypes: true });
		} catch (error) {
			if (isMissing(error)) return [];
			throw error;
		}
		const ids: string[] = [];
		for (const entry of entries)
			if (
				entry.isDirectory() &&
				/^[a-z0-9][a-z0-9-]*$/.test(entry.name) &&
				(await this.owned(entry.name))
			)
				ids.push(entry.name);
		return ids;
	}
	async release(id: string): Promise<void> {
		if (!(await this.owned(id)))
			throw new Error("This main session does not own that pulse.");
		const state = await this.read(id);
		if (state.running)
			throw new Error("Pulse is running; retain ownership until it settles.");
		await unlink(join(this.directory(id), "owner"));
	}
	async read(id: string): Promise<PulseState> {
		try {
			const value: unknown = JSON.parse(
				await readFile(join(this.directory(id), "state.json"), "utf8"),
			);
			if (!validState(value))
				throw new Error(
					`Invalid saved state for ${id}; inspect it before running.`,
				);
			return value;
		} catch (error) {
			if (isMissing(error)) return { firstSeenAt: Date.now() };
			throw error;
		}
	}
	async save(id: string, state: PulseState): Promise<void> {
		const directory = this.directory(id);
		await mkdir(directory, { recursive: true });
		const temporary = join(directory, `${randomUUID()}.tmp`);
		await writeFile(temporary, JSON.stringify(state));
		await rename(temporary, join(directory, "state.json"));
	}
	async history(id: string, event: object): Promise<void> {
		await appendFile(
			join(this.directory(id), "history.jsonl"),
			`${JSON.stringify({ at: Date.now(), ...event })}\n`,
		);
	}
}

function validState(value: unknown): value is PulseState {
	if (
		!value ||
		typeof value !== "object" ||
		!("firstSeenAt" in value) ||
		typeof value.firstSeenAt !== "number"
	)
		return false;
	if ("lastRunAt" in value && typeof value.lastRunAt !== "number") return false;
	if ("lastDueKey" in value && typeof value.lastDueKey !== "string")
		return false;
	if (
		"running" in value &&
		(!value.running ||
			typeof value.running !== "object" ||
			!("runId" in value.running) ||
			typeof value.running.runId !== "string" ||
			!("startedAt" in value.running) ||
			typeof value.running.startedAt !== "number" ||
			("workerId" in value.running &&
				typeof value.running.workerId !== "string"))
	)
		return false;
	if (
		"worker" in value &&
		(!value.worker ||
			typeof value.worker !== "object" ||
			!("owner" in value.worker) ||
			typeof value.worker.owner !== "string" ||
			!("runner" in value.worker) ||
			typeof value.worker.runner !== "string" ||
			!("workerId" in value.worker) ||
			typeof value.worker.workerId !== "string")
	)
		return false;
	return true;
}
