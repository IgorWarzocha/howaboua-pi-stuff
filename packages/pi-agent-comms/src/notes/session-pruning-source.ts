import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
	SessionEntry,
	SessionHeader,
} from "@earendil-works/pi-coding-agent";

export type PruningRecord = SessionEntry | SessionHeader;

/** Read a finite complete-line prefix, with at most one JSON record buffered. */
export async function scanSession(
	path: string,
	end: number,
	visit: (entry: PruningRecord, raw: string) => void | Promise<void>,
): Promise<void> {
	if (end <= 0) throw new Error("Session has not been saved yet.");
	const stream = createReadStream(path, {
		start: 0,
		end: end - 1,
		highWaterMark: 64 * 1024,
	});
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) {
			if (!line) throw new Error("Session contains an empty record.");
			const entry: PruningRecord = JSON.parse(line);
			if (
				!entry ||
				typeof entry !== "object" ||
				typeof entry.type !== "string" ||
				typeof entry.id !== "string" ||
				typeof entry.timestamp !== "string" ||
				(entry.type !== "session" &&
					entry.parentId !== null &&
					typeof entry.parentId !== "string")
			)
				throw new Error("Session contains an invalid record.");
			await visit(entry, line);
		}
	} finally {
		lines.close();
		stream.destroy();
	}
}
