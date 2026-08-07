import type { SemanticGrepConfig } from "./config.js";
import { openIndexDb } from "./db.js";
import { discoverFiles } from "./discovery.js";
import { nextEventLoopTurn } from "./event-loop.js";
import { type IndexStats, syncIndex } from "./indexer.js";
import { tryAcquireIndexLock } from "./lock.js";

export type IndexRunResult =
	| { status: "busy" }
	| { status: "indexed"; stats: IndexStats };

export async function runIndex(
	root: string,
	config: SemanticGrepConfig,
	forceFullRebuild: boolean,
	signal?: AbortSignal,
	onProgress?: (message: string) => void,
): Promise<IndexRunResult> {
	await nextEventLoopTurn();
	signal?.throwIfAborted();
	onProgress?.("scanning project files");
	const discovery = await discoverFiles(root, config);
	signal?.throwIfAborted();
	const release = await tryAcquireIndexLock(root);
	if (!release) return { status: "busy" };
	let db;
	try {
		signal?.throwIfAborted();
		db = openIndexDb(root);
		return {
			status: "indexed",
			stats: await syncIndex(
				db,
				root,
				config,
				forceFullRebuild,
				signal,
				onProgress,
				discovery,
			),
		};
	} finally {
		db?.close();
		await release();
	}
}
