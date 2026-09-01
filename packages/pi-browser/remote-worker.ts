#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	requestBrowserWorker,
	serveBrowserWorker,
} from "./src/browser/worker-server.js";

async function readStdin(): Promise<string> {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main(): Promise<void> {
	if (process.argv.includes("--daemon")) {
		await serveBrowserWorker();
		return;
	}
	const controller = new AbortController();
	const abort = () => controller.abort(new Error("Remote browser interrupted"));
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	try {
		const result = await requestBrowserWorker(
			await readStdin(),
			fileURLToPath(import.meta.url),
			controller.signal,
		);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} finally {
		process.removeListener("SIGINT", abort);
		process.removeListener("SIGTERM", abort);
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	main().catch((error) => {
		process.stderr.write(
			`pi-browser-worker: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
