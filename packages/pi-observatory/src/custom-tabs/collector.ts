import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isWithin, readBounded, type TabBundle } from "./bundle.ts";
import {
	type CollectorRun,
	MAX_SNAPSHOT_BYTES,
	runCollector,
} from "./process.ts";

export interface TabStatus {
	running: boolean;
	lastStartedAt: string | null;
	updatedAt: string | null;
	error: string | null;
}

export interface TabSnapshot {
	data: unknown | null;
	status: TabStatus;
}

export class TabCollector {
	private data: unknown = null;
	private status: TabStatus = {
		running: false,
		lastStartedAt: null,
		updatedAt: null,
		error: null,
	};
	private stopped = false;
	private live = false;
	private cancelled = false;
	private json: string | undefined;
	private timer: NodeJS.Timeout | undefined;
	private active: CollectorRun | undefined;
	private pending: Promise<void> | undefined;
	private readonly stateDirectory: string;
	private readonly bundle: TabBundle;
	private readonly sessions: string;

	constructor(bundle: TabBundle, stateDirectory: string, sessions: string) {
		this.bundle = bundle;
		this.stateDirectory = stateDirectory;
		this.sessions = sessions;
	}

	async initialise(stateRoot: string): Promise<void> {
		await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
		if (
			!isWithin(await realpath(stateRoot), await realpath(this.stateDirectory))
		)
			throw new Error(
				"Tab state directory must stay inside the tab state root",
			);
		try {
			const saved: unknown = JSON.parse(
				(
					await readBounded(
						join(this.stateDirectory, "last-good.json"),
						MAX_SNAPSHOT_BYTES + 1024,
					)
				).toString("utf8"),
			);
			if (!saved || typeof saved !== "object" || Array.isArray(saved))
				throw new Error("Invalid saved snapshot envelope");
			const envelope = saved as Record<string, unknown>;
			if (
				envelope["version"] !== 1 ||
				typeof envelope["updatedAt"] !== "string" ||
				!Number.isFinite(Date.parse(envelope["updatedAt"])) ||
				!Object.hasOwn(envelope, "data")
			)
				throw new Error("Invalid saved snapshot envelope");
			this.data = envelope["data"];
			this.json = JSON.stringify(this.data);
			this.status.updatedAt = envelope["updatedAt"];
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				this.status.error = `Could not restore saved snapshot: ${String(error)}. A successful collector run will replace it.`;
		}
	}

	snapshot(): TabSnapshot {
		return { data: this.data, status: { ...this.status } };
	}

	start(): void {
		if (this.live || this.stopped) return;
		this.live = true;
		void this.once();
	}

	once(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		if (this.pending) return this.pending;
		this.cancelled = false;
		this.pending = this.collect().finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	async pause(): Promise<void> {
		this.live = false;
		this.cancelled = true;
		clearTimeout(this.timer);
		this.active?.stop("Collection paused.");
		await this.pending;
	}

	async close(): Promise<void> {
		this.stopped = true;
		await this.pause();
	}

	private async collect(): Promise<void> {
		this.status.running = true;
		this.status.lastStartedAt = new Date().toISOString();
		try {
			this.active = runCollector(
				this.bundle,
				this.stateDirectory,
				this.sessions,
			);
			const { data } = await this.active.result;
			if (this.stopped || this.cancelled) return;
			const json = JSON.stringify(data);
			if (json !== this.json) {
				const updatedAt = new Date().toISOString();
				await this.persist(json, updatedAt);
				this.data = data;
				this.json = json;
				this.status.updatedAt = updatedAt;
			}
			this.status.error = null;
		} catch (error) {
			if (!this.stopped && !this.cancelled)
				this.status.error =
					error instanceof Error ? error.message : String(error);
		} finally {
			this.active = undefined;
			this.status.running = false;
			if (!this.stopped && this.live)
				this.timer = setTimeout(() => {
					void this.once();
				}, this.bundle.manifest.intervalSeconds * 1000);
		}
	}

	private async persist(json: string, updatedAt: string): Promise<void> {
		const temporary = join(
			this.stateDirectory,
			`last-good.${randomUUID()}.tmp`,
		);
		try {
			await writeFile(
				temporary,
				`{"version":1,"updatedAt":${JSON.stringify(updatedAt)},"data":${json}}`,
				{ mode: 0o600, flag: "wx" },
			);
			await rename(temporary, join(this.stateDirectory, "last-good.json"));
		} catch (error) {
			throw new Error(
				`Could not save collector snapshot: ${String(error)}. Check tab state directory permissions and disk space.`,
			);
		} finally {
			await rm(temporary, { force: true });
		}
	}
}
