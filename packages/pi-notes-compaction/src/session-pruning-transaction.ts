import { randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	readSync,
	renameSync,
	type Stats,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PruningPlan } from "./session-pruning-plan.js";
import {
	pruningContext,
	transformPruningEntry,
} from "./session-pruning-plan.js";
import { scanSession } from "./session-pruning-source.js";

const MAX_COMMIT_TAIL = 4 * 1024 * 1024;

function sameSource(plan: PruningPlan): Stats {
	const current = lstatSync(plan.path);
	if (
		!current.isFile() ||
		current.dev !== plan.source.dev ||
		current.ino !== plan.source.ino ||
		current.size < plan.source.size ||
		(current.size === plan.source.size &&
			current.mtimeMs !== plan.source.mtimeMs)
	)
		throw new Error(
			"Session changed while pruning was prepared. Run now again.",
		);
	return current;
}

/** SDK writes to this already-flushed path are synchronous appends. No await from
 * final identity check through rename: extension/monitor appends cannot interleave.
 * Fork writes a different path; migration rewrites happen before session_start.
 */
export async function commitSessionPruning(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: Pick<ExtensionContext, "sessionManager">,
	plan: PruningPlan,
	checkPolicy: () => void = () => {},
): Promise<{ before: number; after: number }> {
	const valid = () => {
		checkPolicy();
		if (
			ctx.sessionManager.getSessionId() !== plan.sessionId ||
			ctx.sessionManager.getSessionFile() !== plan.path
		)
			throw new Error("Active session changed. Run now again.");
		for (const id of pruningContext(ctx.sessionManager).protectedIds)
			if (plan.ids.has(id) && !plan.protectedIds.has(id))
				throw new Error("Active context changed. Run now again.");
		return sameSource(plan);
	};
	valid();
	const generation = randomUUID();
	pi.appendEntry("notes-session-prune", {
		version: 1,
		sessionId: plan.sessionId,
		generation,
	});
	const temp = `${plan.path}.prune-${generation}.tmp`;
	let output: Awaited<ReturnType<typeof open>> | undefined;
	try {
		output = await open(temp, "wx", plan.source.mode & 0o777);
		const file = output;
		await scanSession(plan.path, plan.source.size, async (entry, raw) => {
			const transformed =
				entry.type === "session"
					? {
							...entry,
							notesPruning: {
								version: 1,
								sessionId: plan.sessionId,
								generation,
							},
						}
					: transformPruningEntry(plan, entry);
			await file.writeFile(
				`${transformed === entry ? raw : JSON.stringify(transformed)}\n`,
			);
		});
		await file.sync();
		await file.close();
		output = undefined;
		// Bounded synchronous commit includes every append since the preview prefix.
		const current = valid();
		const length = current.size - plan.source.size;
		if (length > MAX_COMMIT_TAIL)
			throw new Error("Session grew too much during pruning. Run now again.");
		const input = openSync(plan.path, "r");
		let tail: Buffer;
		try {
			tail = Buffer.alloc(length);
			let offset = 0;
			while (offset < length) {
				const read = readSync(
					input,
					tail,
					offset,
					length - offset,
					plan.source.size + offset,
				);
				if (!read) throw new Error("Session changed during pruning.");
				offset += read;
			}
		} finally {
			closeSync(input);
		}
		if (tail.length && tail.at(-1) !== 10)
			throw new Error("Session has an incomplete append. Run now again.");
		const fd = openSync(temp, "a");
		try {
			if (tail.length) writeFileSync(fd, tail);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		const after = statSync(temp).size;
		renameSync(temp, plan.path);
		return { before: current.size, after };
	} finally {
		await output?.close();
		try {
			unlinkSync(temp);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
