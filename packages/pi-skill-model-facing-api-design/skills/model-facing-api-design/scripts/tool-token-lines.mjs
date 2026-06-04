#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

const cwdArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const root = resolve(cwdArg ?? process.cwd());
const json = process.argv.includes("--json");
if (process.argv.some((arg) => arg.startsWith("--top"))) {
	console.error("--top is intentionally unsupported; full output prevents hidden prompt costs.");
	process.exit(1);
}

const enc = getEncoding("o200k_base");
const skipDirs = new Set(["node_modules", "dist", ".git", ".pi", ".changeset", "tests", "test", "coverage"]);
const skipExts = new Set([".d.ts"]);
const codeExts = new Set([".ts", ".tsx", ".js", ".mjs"]);

function extname(path) {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index);
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (skipDirs.has(name)) continue;
		const path = join(dir, name);
		const st = statSync(path);
		if (st.isDirectory()) walk(path, out);
		else if (codeExts.has(extname(path)) && ![...skipExts].some((ext) => path.endsWith(ext))) out.push(path);
	}
	return out;
}

function tokenCount(text) {
	return enc.encode(text).length;
}

function shownText(line) {
	return line.trim().replace(/\s+/g, " ");
}

function braceDelta(line) {
	let delta = 0;
	let quote = null;
	let escaped = false;
	for (const ch of line) {
		if (escaped) { escaped = false; continue; }
		if (quote) {
			if (ch === "\\") escaped = true;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "{" || ch === "(" || ch === "[") delta++;
		else if (ch === "}" || ch === ")" || ch === "]") delta--;
	}
	return delta;
}

function startsToolDefinition(line) {
	return /\bregisterTool\s*\(/.test(line) || /\bcreate[A-Za-z0-9_]*Tool\s*\([^)]*\)\s*(?::[^=]+)?\s*\{?\s*$/.test(line);
}

function startsParameterSchema(line) {
	return /\b(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*(?:Type\.|StringEnum\s*\()/.test(line) || /\bparameters\s*:\s*Type\./.test(line);
}

function startsToolSchema(line) {
	return startsToolDefinition(line) || startsParameterSchema(line);
}

function isSurfaceLine(line, inPromptGuidelines, inParameterSchema) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("//")) return false;
	if (/^\s*(name|label|description|promptSnippet|promptGuidelines|parameters)\s*:/.test(line)) return true;
	if (inParameterSchema && /(?:Type\.(String|Number|Boolean|Integer|Literal|Union|Optional|Array|Object|Unsafe)|StringEnum).*\(/.test(line)) return true;
	if (inPromptGuidelines && /["'`]/.test(line) && !/^[\]})]/.test(trimmed)) return true;
	return false;
}

function addRow(rows, rel, index, line, kind) {
	const text = shownText(line);
	if (!text) return;
	rows.push({ file: rel, line: index + 1, tokens: tokenCount(text), kind, text });
}

if (!existsSync(root)) {
	console.error(`Path not found: ${root}`);
	process.exit(1);
}

const rows = [];
for (const file of walk(root)) {
	const rel = relative(root, file);
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	let inTool = false;
	let inParameterSchema = false;
	let depth = 0;
	let inPromptGuidelines = false;
	let pendingProp = null;

	lines.forEach((line, index) => {
		if (!inTool && !inParameterSchema && startsToolSchema(line)) {
			inTool = startsToolDefinition(line);
			inParameterSchema = startsParameterSchema(line);
			depth = Math.max(1, braceDelta(line));
		} else if (inTool || inParameterSchema) {
			depth += braceDelta(line);
		}

		if (!inTool && !inParameterSchema) return;
		const wasInPromptGuidelines = inPromptGuidelines;
		if (/\bpromptGuidelines\s*:/.test(line)) inPromptGuidelines = true;

		if (pendingProp && /["`']/.test(line)) {
			addRow(rows, rel, index, line, pendingProp);
			if (/[,;]\s*$/.test(line.trim())) pendingProp = null;
		} else if (isSurfaceLine(line, wasInPromptGuidelines, inParameterSchema)) {
			addRow(rows, rel, index, line, inParameterSchema ? "schema" : "tool");
			if (/\b(description|promptSnippet)\s*:\s*$/.test(line)) pendingProp = inParameterSchema ? "schema" : "tool";
		}

		if (wasInPromptGuidelines && /^\s*\]/.test(line)) inPromptGuidelines = false;
		if (depth <= 0) {
			inTool = false;
			inParameterSchema = false;
			inPromptGuidelines = false;
			pendingProp = null;
		}
	});
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);
if (json) {
	console.log(JSON.stringify({ root, totalTokens, rows }, null, 2));
} else {
	for (const row of rows) console.log(`${String(row.tokens).padStart(4)}  ${row.file}:${row.line}  ${row.kind.padEnd(6)}  ${row.text}`);
	console.error(`\ntool surface lines: ${rows.length}`);
	console.error(`o200k_base tokens: ${totalTokens}`);
}
