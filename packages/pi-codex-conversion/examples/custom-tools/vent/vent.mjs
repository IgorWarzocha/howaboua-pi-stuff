#!/usr/bin/env node

import { appendFile, open } from "node:fs/promises";
import { resolve } from "node:path";

const ALLOWED_KEYS = new Set(["thought", "trigger"]);
const HEADING =
	"# VENT\n\nFeedback log. Repeated/systemic workflow friction that should become future automation, docs, or workflow fixes.\n\n";

function clean(value) {
	return value.trim().replace(/\r\n/g, "\n");
}

function parseRequest(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("input must be a JSON object");
	}
	const unknown = Object.keys(value).filter((key) => !ALLOWED_KEYS.has(key));
	if (unknown.length > 0) {
		throw new Error(
			`unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
		);
	}
	if (typeof value.thought !== "string" || !clean(value.thought)) {
		throw new Error("thought must be a non-empty string");
	}
	if (
		value.trigger !== undefined &&
		(typeof value.trigger !== "string" || !clean(value.trigger))
	) {
		throw new Error("trigger must be a non-empty string when provided");
	}
	return {
		thought: clean(value.thought),
		trigger: value.trigger === undefined ? undefined : clean(value.trigger),
	};
}

function timestamp(now = new Date()) {
	const date = [
		String(now.getFullYear()).slice(-2),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("-");
	const time = [
		String(now.getHours()).padStart(2, "0"),
		String(now.getMinutes()).padStart(2, "0"),
	].join(":");
	return `${date} ${time}`;
}

async function ensureFile(path) {
	try {
		const handle = await open(path, "wx");
		try {
			await handle.writeFile(HEADING, "utf8");
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (error?.code !== "EEXIST") throw error;
	}
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const request = parseRequest(await readStdin());
	const path = resolve(process.cwd(), "VENT.md");
	const now = timestamp();
	const entry = [
		`## ${now}${request.trigger ? ` — ${request.trigger}` : ""}`,
		"",
		request.thought,
		"",
	].join("\n");
	await ensureFile(path);
	await appendFile(path, entry, "utf8");
	process.stdout.write(`Appended vent entry to VENT.md (${now}).\n`);
}

main().catch((error) => {
	process.stderr.write(
		`vent: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
