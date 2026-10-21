import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { openIndex } from "./index-store.ts";
import { ingest } from "./ingestion.ts";
import { project } from "./projection.ts";

function main(): void {
	const args = process.argv.slice(2);
	if (
		args.length &&
		(args.length !== 2 ||
			args[0] !== "--logs" ||
			!args[1] ||
			!isAbsolute(args[1]))
	) {
		throw new Error("Usage: node collect.ts [--logs ABSOLUTE_DIRECTORY]");
	}
	const state = process.env["OBSERVATORY_STATE_DIR"];
	if (!state || !isAbsolute(state))
		throw new Error(
			"OBSERVATORY_STATE_DIR must be an absolute tab state directory.",
		);
	const directory = resolve(
		args[1] ??
			join(
				process.env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent"),
				"pi-codex-logs",
			),
	);
	const db = openIndex(state, directory);
	try {
		console.log(JSON.stringify(project(db, ingest(db, directory))));
	} finally {
		db.close();
	}
}

try {
	main();
} catch (error) {
	console.error(
		error instanceof Error ? error.message : "Cache collection failed.",
	);
	process.exitCode = 1;
}
