import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDisplayPrefixLength, resolvePrefix } from "./discovery.js";
import { getPages, waitForOpenedTarget } from "./pages.js";
import { waitForTurn } from "./serial.js";
import type { CdpConnection, PageInfo } from "./types.js";
import { asRecord, errorMessage } from "./types.js";
import { assertHttpUrl } from "./url.js";

const TARGET_ID = /^[A-Za-z0-9_-]{1,128}$/;

function missing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class BrowserTabs {
	private readonly cdp: CdpConnection;
	private readonly directory: string;
	private tail: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		cdp: CdpConnection,
		ownerId: string,
		directory: string,
		browserUrl: string,
	) {
		this.cdp = cdp;
		// Browser endpoint identity changes on restart. Restored user tabs must
		// never inherit an old automation session's permission to close them.
		const scope = createHash("sha256")
			.update(`${browserUrl}\0${ownerId}`)
			.digest("hex");
		this.directory = join(directory, scope);
	}

	list(signal?: AbortSignal): Promise<PageInfo[]> {
		return this.enqueue(() => this.listNow(signal), signal);
	}

	async shutdown(): Promise<void> {
		this.closed = true;
		await this.tail;
	}

	private enqueue<T>(
		action: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const pending = this.tail.then(() => {
			signal?.throwIfAborted();
			if (this.closed) throw new Error("Browser session closed");
			return action();
		});
		this.tail = pending.then(
			() => undefined,
			() => undefined,
		);
		return waitForTurn(pending, signal);
	}

	private async listNow(signal?: AbortSignal): Promise<PageInfo[]> {
		// Read ownership first so a concurrent creation is not pruned against an
		// older browser target snapshot.
		const owned = await this.readOwned();
		const pages = await getPages(this.cdp, signal);
		const known = new Set(owned);
		// Resolve descendants before removing closed openers from the registry.
		let changed = true;
		while (changed) {
			changed = false;
			for (const page of pages) {
				if (
					!page.openerId ||
					!known.has(page.openerId) ||
					known.has(page.targetId)
				)
					continue;
				await this.remember(page.targetId);
				known.add(page.targetId);
				changed = true;
			}
		}
		const live = new Set(pages.map((page) => page.targetId));
		await Promise.all(
			owned.filter((id) => !live.has(id)).map((id) => this.forget(id)),
		);
		return pages.map((page) => ({ ...page, owned: known.has(page.targetId) }));
	}

	async resolve(
		refId: string,
		signal?: AbortSignal,
	): Promise<{ page: PageInfo; refId: string }> {
		const pages = await this.list(signal);
		const ids = pages.map((page) => page.targetId);
		const targetId = resolvePrefix(refId, ids, "target", "Run tabs.");
		const page = pages.find((candidate) => candidate.targetId === targetId);
		if (!page) throw new Error("Tab disappeared; run tabs again");
		return { page, refId: targetId.slice(0, getDisplayPrefixLength(ids)) };
	}

	async open(url: string, signal?: AbortSignal): Promise<{ refId: string }> {
		assertHttpUrl(url);
		const targetId = await this.enqueue(async () => {
			// Once dispatched, preserve the reply and ownership write even if the
			// caller aborts. Listings and shutdown wait for this critical section.
			let response: Record<string, unknown>;
			try {
				response = asRecord(
					await this.cdp.send("Target.createTarget", { url, background: true }),
					"Target.createTarget response",
				);
			} catch (error) {
				throw new Error(
					`Chrome did not confirm tab creation; a shared tab may exist. Run tabs before retrying: ${errorMessage(error)}`,
				);
			}
			if (typeof response["targetId"] !== "string")
				throw new Error(
					"Chrome did not return a new tab target; run tabs before retrying",
				);
			const created = response["targetId"];
			try {
				await this.remember(created);
			} catch (error) {
				throw new Error(
					`Opened tab ${created} but could not save ownership; it remains shared: ${errorMessage(error)}`,
				);
			}
			return created;
		}, signal);
		await waitForOpenedTarget(this.cdp, targetId, url, 5_000, signal);
		const { refId } = await this.resolve(targetId, signal);
		return { refId };
	}

	async show(refId: string, signal?: AbortSignal): Promise<string> {
		const resolved = await this.resolve(refId, signal);
		await this.cdp.send(
			"Target.activateTarget",
			{ targetId: resolved.page.targetId },
			undefined,
			signal,
		);
		return resolved.refId;
	}

	async close(
		refId: string,
		signal?: AbortSignal,
	): Promise<{ targetId: string; refId: string }> {
		const resolved = await this.resolve(refId, signal);
		if (!resolved.page.owned)
			throw new Error(
				"Only tabs owned by this Pi session can be closed; shared tabs remain open",
			);
		const targetId = resolved.page.targetId;
		const response = asRecord(
			await this.cdp.send(
				"Target.closeTarget",
				{ targetId },
				undefined,
				signal,
			),
			"Target.closeTarget response",
		);
		if (response["success"] !== true)
			throw new Error("Chrome did not close the tab; run tabs to inspect it");
		await this.forget(targetId);
		return { targetId, refId: resolved.refId };
	}

	private targetPath(targetId: string): string {
		if (!TARGET_ID.test(targetId))
			throw new Error("Chrome returned an invalid target id");
		return join(this.directory, targetId);
	}

	private async readOwned(): Promise<string[]> {
		try {
			const info = await lstat(this.directory);
			if (!info.isDirectory() || info.isSymbolicLink())
				throw new Error("Invalid browser ownership directory");
			const files = await readdir(this.directory, { withFileTypes: true });
			for (const file of files) {
				if (!file.isFile() || !TARGET_ID.test(file.name))
					throw new Error(
						"Invalid browser ownership record; refusing to infer tab ownership",
					);
			}
			return files.map((file) => file.name);
		} catch (error) {
			if (missing(error)) return [];
			throw error;
		}
	}

	private async remember(targetId: string): Promise<void> {
		const path = this.targetPath(targetId);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const info = await lstat(this.directory);
		if (!info.isDirectory() || info.isSymbolicLink())
			throw new Error("Invalid browser ownership directory");
		// One record per target avoids read/modify/write races between clients of
		// the same Pi session and survives reloads or managed-worker upgrades.
		try {
			await writeFile(path, "", { flag: "wx", mode: 0o600 });
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;
			if (!(await lstat(path)).isFile())
				throw new Error("Invalid browser ownership record");
		}
	}

	private async forget(targetId: string): Promise<void> {
		await rm(this.targetPath(targetId), { force: true });
	}
}
