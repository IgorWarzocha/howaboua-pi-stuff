#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const ALLOWED_KEYS = new Set(["query", "top_k"]);
const AGENT_DIR =
	process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "semantic-grep.json");
const MAX_OUTPUT_BYTES = 45_000;
const localRequire = createRequire(import.meta.url);
const agentRequire = createRequire(join(AGENT_DIR, "npm", "package.json"));
const Database = (() => {
	try {
		return localRequire("better-sqlite3");
	} catch {
		return agentRequire("better-sqlite3");
	}
})();

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
	if (typeof value.query !== "string" || !value.query.trim()) {
		throw new Error("query must be a non-empty string");
	}
	if (
		value.top_k !== undefined &&
		(typeof value.top_k !== "number" || !Number.isFinite(value.top_k))
	) {
		throw new Error("top_k must be a finite number when provided");
	}
	return { query: value.query.trim(), top_k: value.top_k };
}

function deepMerge(base, override) {
	const out = Array.isArray(base) ? [...base] : { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			key in out
		) {
			out[key] = deepMerge(out[key], value);
		} else if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

function readConfig(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function hasMarker(dir, markers) {
	return markers.some((marker) => existsSync(join(dir, marker)));
}

function findProjectRoot(cwd, config) {
	let dir = resolve(cwd);
	while (true) {
		if (hasMarker(dir, config.safety.projectMarkers)) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return config.safety.requireProjectMarker ? undefined : resolve(cwd);
}

function samePath(a, b) {
	return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function denyReason(root, config) {
	for (const denied of config.safety.denyRootPaths) {
		if (samePath(root, expandHome(denied))) {
			return `refusing to index protected root: ${denied}`;
		}
	}
	const base = basename(root);
	if (config.safety.denyRootBasenames.includes(base)) {
		return `refusing to index standard system/user directory: ${base}`;
	}
	try {
		if (!statSync(root).isDirectory()) return `root does not exist: ${root}`;
	} catch {
		return `root does not exist: ${root}`;
	}
	return undefined;
}

async function embed(input, config) {
	const headers = { "Content-Type": "application/json" };
	if (config.embeddings.apiKey) {
		headers.Authorization = `Bearer ${config.embeddings.apiKey}`;
	}
	const response = await fetch(config.embeddings.url, {
		method: "POST",
		headers,
		body: JSON.stringify({ model: config.embeddings.model, input }),
	});
	if (!response.ok) {
		throw new Error(
			`embedding endpoint ${response.status}: ${await response.text()}`,
		);
	}
	const json = await response.json();
	const vector = json.data?.[0]?.embedding;
	if (!Array.isArray(vector) || vector.length === 0) {
		throw new Error("embedding response did not contain data[0].embedding");
	}
	return vector;
}

function cosine(a, b) {
	let dot = 0;
	let aa = 0;
	let bb = 0;
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const av = a[index] ?? 0;
		const bv = b[index] ?? 0;
		dot += av * bv;
		aa += av * av;
		bb += bv * bv;
	}
	return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

async function search(db, query, topK, config) {
	const queryVector = await embed(query, config);
	const best = [];
	let minimum = Number.NEGATIVE_INFINITY;
	for (const row of db
		.prepare("select file, start_line, end_line, text, vector from chunks")
		.iterate()) {
		const score = cosine(queryVector, JSON.parse(row.vector));
		if (best.length >= topK && score <= minimum) continue;
		best.push({
			file: row.file,
			startLine: row.start_line,
			endLine: row.end_line,
			text: row.text,
			score,
		});
		best.sort((a, b) => b.score - a.score);
		if (best.length > topK) best.pop();
		minimum = best.at(-1)?.score ?? Number.NEGATIVE_INFINITY;
	}
	return best;
}

function formatMatches(matches) {
	if (matches.length === 0) return "No semantic grep matches.";
	const sections = [];
	let used = 0;
	for (const [index, match] of matches.entries()) {
		const heading = `## ${index + 1}. ${match.file}:${match.startLine}-${match.endLine} score=${match.score.toFixed(4)}\n\n`;
		const fenceStart = `\`\`\`${match.file}\n`;
		const fenceEnd = "\n\`\`\`";
		const remaining =
			MAX_OUTPUT_BYTES -
			used -
			heading.length -
			fenceStart.length -
			fenceEnd.length;
		if (remaining <= 200) {
			sections.push(`… ${matches.length - index} additional matches omitted.`);
			break;
		}
		const truncated = match.text.length > remaining;
		const text = truncated
			? `${match.text.slice(0, Math.max(0, remaining - 20))}\n… snippet truncated`
			: match.text;
		const section = `${heading}${fenceStart}${text}${fenceEnd}`;
		sections.push(section);
		used += section.length + 2;
		if (truncated) {
			sections.push(
				`… ${matches.length - index - 1} additional matches omitted.`,
			);
			break;
		}
	}
	return sections.join("\n\n");
}

function boundOutput(text) {
	if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
	const suffix = "\n\n… output truncated.";
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (
			Buffer.byteLength(text.slice(0, middle) + suffix, "utf8") <=
			MAX_OUTPUT_BYTES
		) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return text.slice(0, low) + suffix;
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const request = parseRequest(await readStdin());
	if (!existsSync(CONFIG_PATH)) {
		throw new Error(`configuration not found at ${CONFIG_PATH}`);
	}
	const globalConfig = readConfig(CONFIG_PATH);
	const root = findProjectRoot(process.cwd(), globalConfig);
	if (!root) {
		process.stdout.write("Semantic grep skipped: no project marker found.\n");
		return;
	}
	const projectConfigPath = join(root, ".pi", "semantic-grep.json");
	const config = existsSync(projectConfigPath)
		? deepMerge(globalConfig, readConfig(projectConfigPath))
		: globalConfig;
	const denied = denyReason(root, config);
	if (denied) {
		process.stdout.write(`Semantic grep skipped: ${denied}.\n`);
		return;
	}
	const dbFile = join(root, ".pi", "semantic-grep.sqlite");
	if (!existsSync(dbFile)) {
		throw new Error(
			`index not found at ${dbFile}; the extension should create it at session start`,
		);
	}
	const topK = Math.min(
		Math.max(1, request.top_k ?? config.search.defaultTopK),
		config.search.maxTopK,
	);
	const db = new Database(dbFile, { readonly: true, fileMustExist: true });
	try {
		const output = formatMatches(await search(db, request.query, topK, config));
		process.stdout.write(`${boundOutput(output)}\n`);
	} finally {
		db.close();
	}
}

main().catch((error) => {
	process.stderr.write(
		`semantic_grep: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
