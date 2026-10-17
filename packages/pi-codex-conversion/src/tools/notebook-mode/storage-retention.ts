import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expireNotebookSessionCheckpoints } from "./checkpoint-activity.ts";

export type NotebookJournalRetention = "off" | "week" | "on";
export type NotebookCheckpointRetention = "never" | "month" | "week";
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const pendingMaintenance = new Map<string, boolean>();

export function normalizeNotebookJournalRetention(value: unknown): NotebookJournalRetention {
	return value === "off" || value === "on" ? value : "week";
}

// Read the global preference at the write boundary: another session may have disabled journals.
function notebookStorageSettings(agentDir: string): Record<string, unknown> {
	const path = join(agentDir, "pi-codex-conversion.json");
	if (!existsSync(path)) return {};
	const config: unknown = JSON.parse(readFileSync(path, "utf8"));
	const notebook = config && typeof config === "object" && "notebook" in config ? config.notebook : undefined;
	return notebook && typeof notebook === "object" && !Array.isArray(notebook) ? notebook as Record<string, unknown> : {};
}

export function notebookJournalRetention(agentDir: string): NotebookJournalRetention {
	return normalizeNotebookJournalRetention(notebookStorageSettings(agentDir)["journals"]);
}

export function notebookCheckpointRetention(agentDir: string): NotebookCheckpointRetention {
	const value = notebookStorageSettings(agentDir)["checkpointCleanup"];
	return value === "month" || value === "week" ? value : "never";
}

export function notebookJournalsDirectory(agentDir: string): string {
	return join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "journals");
}

export function scheduleNotebookStorageMaintenance(agentDir: string, force = false): void {
	if (pendingMaintenance.has(agentDir)) {
		if (force) pendingMaintenance.set(agentDir, true);
		return;
	}
	pendingMaintenance.set(agentDir, force);
	setImmediate(async () => {
		const requestedForce = pendingMaintenance.get(agentDir) ?? false;
		pendingMaintenance.set(agentDir, false);
		try { await maintainNotebookStorage(agentDir, requestedForce); } catch (error) {
			console.warn(`Notebook storage cleanup failed; retry its cleanup setting in /codex: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			const repeat = pendingMaintenance.get(agentDir);
			pendingMaintenance.delete(agentDir);
			if (repeat) scheduleNotebookStorageMaintenance(agentDir, true);
		}
	}).unref();
}

// One daily pass for the two independently configured stores; project/profile state is never aged out.
export async function maintainNotebookStorage(agentDir: string, force = false, now = Date.now()): Promise<void> {
	const root = notebookJournalsDirectory(agentDir);
	const stamp = join(dirname(root), "storage-maintenance");
	if (!force && existsSync(stamp) && now - statSync(stamp).mtimeMs < 24 * 60 * 60 * 1_000) return;
	maintainNotebookJournals(agentDir, now);
	await expireNotebookSessionCheckpoints(agentDir, () => {
		const retention = notebookCheckpointRetention(agentDir);
		return retention === "never" ? undefined : retention === "month" ? 30 * 24 * 60 * 60 * 1_000 : WEEK_MS;
	}, now);
	mkdirSync(dirname(stamp), { recursive: true });
	writeFileSync(stamp, "", { mode: 0o600 });
}

export function maintainNotebookJournals(agentDir: string, now = Date.now()): void {
	const retention = notebookJournalRetention(agentDir);
	const root = notebookJournalsDirectory(agentDir);
	if (retention === "off") {
		rmSync(root, { recursive: true, force: true });
	} else if (retention === "week" && existsSync(root)) {
		for (const project of readdirSync(root, { withFileTypes: true })) {
			if (!project.isDirectory() || !/^[a-f0-9]{64}$/.test(project.name)) continue;
			const directory = join(root, project.name);
			const groups = new Map<string, string[]>();
			for (const file of readdirSync(directory, { withFileTypes: true })) {
				const match = file.name.match(/^([a-f0-9]{64})(?:\.previous)?\.ipynb(?:\.events\.jsonl|(?:\.replacement)?(?:\.[a-f0-9-]{36}\.tmp)?)$/);
				if (!file.isFile() || !match) continue;
				const files = groups.get(match[1]!) ?? [];
				files.push(join(directory, file.name));
				groups.set(match[1]!, files);
			}
			for (const files of groups.values()) removeExpiredNotebookJournalFiles(files, now);
		}
	}
}

export function removeExpiredNotebookJournalFiles(files: string[], now = Date.now()): void {
	const updatedAt = Math.max(...files.map(file => {
		try { return statSync(file).mtimeMs; } catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
			throw error;
		}
	}));
	if (now - updatedAt >= WEEK_MS) for (const file of files) rmSync(file, { force: true });
}
