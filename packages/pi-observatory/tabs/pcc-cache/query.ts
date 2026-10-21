import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { queryRecords, validateQuery } from "./query-records.ts";

async function main(): Promise<void> {
	const state = process.env["OBSERVATORY_STATE_DIR"];
	if (!state || !isAbsolute(state))
		throw new Error(
			"OBSERVATORY_STATE_DIR must be an absolute tab state directory.",
		);
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of process.stdin) {
		if (!Buffer.isBuffer(chunk)) throw new Error("Invalid cache query input.");
		bytes += chunk.length;
		if (bytes > 16 * 1024) throw new Error("Cache query exceeds 16 KiB.");
		chunks.push(chunk);
	}
	const query = validateQuery(
		JSON.parse(Buffer.concat(chunks).toString("utf8")),
	);
	// Do not initialise the index or read source logs from an HTTP-triggered query.
	const db = new DatabaseSync(join(state, "collector.sqlite"), {
		readOnly: true,
	});
	try {
		console.log(JSON.stringify(queryRecords(db, query)));
	} finally {
		db.close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Cache query failed.");
	process.exitCode = 1;
});
