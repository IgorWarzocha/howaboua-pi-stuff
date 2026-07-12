#!/usr/bin/env node

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ALLOWED_KEYS = new Set(["name", "description", "body"]);

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
	for (const key of ALLOWED_KEYS) {
		if (typeof value[key] !== "string" || !value[key].trim()) {
			throw new Error(`${key} must be a non-empty string`);
		}
	}
	return {
		name: value.name.trim(),
		description: value.description.trim(),
		body: value.body.replace(/\r\n/g, "\n"),
	};
}

function slugify(value) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function stripFrontmatter(body) {
	const match = body.match(/^---\n[\s\S]+?\n---\s*\n?/);
	return match ? body.slice(match[0].length) : body;
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const request = parseRequest(await readStdin());
	const slug = slugify(request.name) || "workflow";
	const workflowPath = join(
		process.cwd(),
		".pi",
		"workflows",
		slug,
		"SKILL.md",
	);
	const content = [
		"---",
		`name: ${JSON.stringify(request.name)}`,
		`description: ${JSON.stringify(request.description)}`,
		"---",
		"",
		stripFrontmatter(request.body).trim(),
		"",
	].join("\n");
	await mkdir(dirname(workflowPath), { recursive: true });
	const temporaryPath = `${workflowPath}.${process.pid}.tmp`;
	try {
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, workflowPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
	process.stdout.write(`Workflow created at ${workflowPath}\n`);
}

main().catch((error) => {
	process.stderr.write(
		`workflows_create: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
