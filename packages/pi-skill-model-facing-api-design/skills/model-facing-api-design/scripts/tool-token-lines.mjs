#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { getEncoding } from "js-tiktoken";

const args = process.argv.slice(2);
const json = args.includes("--json");
const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--json");
const positional = args.filter((arg) => !arg.startsWith("--"));

if (unknownFlags.length > 0 || positional.length > 1) {
	console.error("Usage: tool-token-lines.mjs [--json] [extension-file-or-directory]");
	process.exit(1);
}

const root = resolve(positional[0] ?? process.cwd());
const enc = getEncoding("o200k_base");
const skipDirs = new Set(["node_modules", "dist", ".git", ".pi", ".changeset", "tests", "test", "coverage"]);
const codeExts = new Set([".ts", ".tsx", ".js", ".mjs"]);
const legacyPatterns = [
	{
		pattern: /@sinclair\/typebox(?:\/compiler)?/,
		message: "Replace @sinclair/typebox with typebox 1.x and update the schema imports.",
	},
	{
		pattern: /@mariozechner\/pi-[A-Za-z0-9-]+/,
		message: "Replace the old Pi package scope with the matching @earendil-works/pi-* package.",
	},
	{
		pattern: /\b(?:CustomAgentTool|ToolAPI|ToolContext|ToolSessionEvent)\b/,
		message: "Port removed custom-tool types and execution APIs to the current ExtensionAPI tool contract.",
	},
];

function isCodeFile(path) {
	return codeExts.has(extname(path)) && !path.endsWith(".d.ts");
}

function walk(path, out = []) {
	const st = statSync(path);
	if (!st.isDirectory()) {
		if (isCodeFile(path)) out.push(path);
		return out;
	}

	for (const name of readdirSync(path)) {
		if (skipDirs.has(name)) continue;
		const child = join(path, name);
		const childStat = statSync(child);
		if (childStat.isDirectory()) walk(child, out);
		else if (isCodeFile(child)) out.push(child);
	}
	return out;
}

function walkLegacyCandidates(path, out = []) {
	const st = statSync(path);
	if (!st.isDirectory()) {
		if (isCodeFile(path) || basename(path) === "package.json") out.push(path);
		return out;
	}

	for (const name of readdirSync(path)) {
		if (skipDirs.has(name)) continue;
		const child = join(path, name);
		const childStat = statSync(child);
		if (childStat.isDirectory()) walkLegacyCandidates(child, out);
		else if (isCodeFile(child) || name === "package.json") out.push(child);
	}
	return out;
}

function findLegacyIssues(path) {
	const base = statSync(path).isDirectory() ? path : resolve(path, "..");
	const issues = [];
	for (const file of walkLegacyCandidates(path)) {
		const lines = readFileSync(file, "utf8").split(/\r?\n/);
		const packageJson = basename(file) === "package.json";
		let inImport = false;
		lines.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
			if (/^\s*import\b/.test(line)) inImport = true;
			const dependencyContext = packageJson || inImport || /\brequire\s*\(/.test(line);
			if (!dependencyContext) return;
			for (const legacy of legacyPatterns) {
				if (!legacy.pattern.test(line)) continue;
				issues.push({ file: relative(base, file), line: index + 1, message: legacy.message, text: shownText(line) });
			}
			if (inImport && (/\bfrom\s*["']/.test(line) || /;\s*$/.test(line))) inImport = false;
		});
	}
	return issues;
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
		if (escaped) {
			escaped = false;
			continue;
		}
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
	return (
		/\b(?:registerTool|defineTool)\s*\(/.test(line) ||
		/\bcreate[A-Za-z0-9_]*Tool\s*\([^)]*\)\s*(?::[^=]+)?\s*\{?\s*$/.test(line)
	);
}

function startsParameterSchema(line) {
	return (
		/\b(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*(?:Type\.|StringEnum\s*\()/.test(line) ||
		/\bparameters\s*:\s*(?:Type\.|StringEnum\s*\()/.test(line)
	);
}

function startsInlineParameters(line) {
	return /\bparameters\s*:\s*(?:Type\.|StringEnum\s*\()/.test(line);
}

function isToolPromptLine(line) {
	return /^\s*(name|description|promptSnippet|promptGuidelines)\s*:/.test(line);
}

function isSchemaLine(line) {
	const property = line.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:Type\.|StringEnum\b)/)?.[1];
	if (property && property !== "parameters") return true;
	return /^\s*description\s*:/.test(line) || /\b(?:Type\.[A-Za-z]+|StringEnum)\b.*\bdescription\s*:/.test(line);
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

const legacyIssues = findLegacyIssues(root);
if (legacyIssues.length > 0) {
	if (json) {
		console.log(
			JSON.stringify(
				{
					root,
					error: "legacy_pi_tool_api",
					message: "Port this extension to the current Pi tool API before model-facing review.",
					issues: legacyIssues,
				},
				null,
				2,
			),
		);
	} else {
		console.error("Legacy Pi tool API detected. Port before model-facing review:\n");
		for (const issue of legacyIssues) {
			console.error(`- ${issue.file}:${issue.line}: ${issue.message}`);
			console.error(`  ${issue.text}`);
		}
	}
	process.exit(2);
}

const rows = [];
for (const file of walk(root)) {
	const rel = relative(statSync(root).isDirectory() ? root : resolve(root, ".."), file);
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	let inTool = false;
	let inParameterSchema = false;
	let inInlineParameters = false;
	let inPromptGuidelines = false;
	let pendingProp = null;
	let depth = 0;
	let inlineParameterDepth = 0;

	lines.forEach((line, index) => {
		const delta = braceDelta(line);
		if (!inTool && !inParameterSchema && startsToolDefinition(line)) {
			inTool = true;
			depth = Math.max(1, delta);
		} else if (!inTool && !inParameterSchema && startsParameterSchema(line)) {
			inParameterSchema = true;
			depth = Math.max(1, delta);
		} else if (inTool || inParameterSchema) {
			depth += delta;
		}

		if (!inTool && !inParameterSchema) return;

		if (inTool && !inInlineParameters && startsInlineParameters(line)) {
			inInlineParameters = true;
			inlineParameterDepth = Math.max(1, delta);
		} else if (inInlineParameters) {
			inlineParameterDepth += delta;
		}

		const wasInGuidelines = inPromptGuidelines;
		if (/\bpromptGuidelines\s*:/.test(line)) inPromptGuidelines = true;

		const kind = inParameterSchema || inInlineParameters ? "schema" : "prompt";
		if (pendingProp && /["`']/.test(line)) {
			addRow(rows, rel, index, line, pendingProp);
			if (/[,;]\s*$/.test(line.trim())) pendingProp = null;
		} else if (wasInGuidelines && /["'`]/.test(line) && !/^[\]})]/.test(line.trim())) {
			addRow(rows, rel, index, line, "prompt");
		} else if ((kind === "prompt" && isToolPromptLine(line)) || (kind === "schema" && isSchemaLine(line))) {
			addRow(rows, rel, index, line, kind);
			if (/\b(description|promptSnippet)\s*:\s*$/.test(line)) pendingProp = kind;
		}

		if (wasInGuidelines && /^\s*\]/.test(line)) inPromptGuidelines = false;
		if (inInlineParameters && inlineParameterDepth <= 0) inInlineParameters = false;
		if (depth <= 0) {
			inTool = false;
			inParameterSchema = false;
			inInlineParameters = false;
			inPromptGuidelines = false;
			pendingProp = null;
		}
	});
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
const measurement = "o200k tokens over detected source lines; heuristic proxy, not serialized prompt cost";

if (json) {
	console.log(JSON.stringify({ root, measurement, totalTokens, rows }, null, 2));
} else {
	for (const row of rows) {
		console.log(`${String(row.tokens).padStart(4)}  ${row.file}:${row.line}  ${row.kind.padEnd(6)}  ${row.text}`);
	}
	console.error(`\ndetected surface lines: ${rows.length}`);
	console.error(`o200k source-line token proxy: ${totalTokens}`);
	console.error("heuristic only; dynamic strings and provider serialization may differ");
}
