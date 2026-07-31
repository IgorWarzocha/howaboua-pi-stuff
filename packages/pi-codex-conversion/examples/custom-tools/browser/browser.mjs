#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const CDP_PATH = join(TOOL_DIR, "cdp.mjs");
const REMOTE_TOOL_PATH = undefined;
// const REMOTE_TOOL_PATH = "/absolute/path/to/codex-conversion-custom-tools/browser/browser.mjs";
const HOSTS = new Set([
	// "workstation",
]);
const HOST_ALIASES = new Map([
	// ["workstation.local", "workstation"],
]);
const RESPONSE_LENGTHS = new Set(["short", "medium", "long"]);
const RESULT_TTL_MS = 60 * 60 * 1000;
const SCREENSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_BUDGET_BYTES = 32_000;
const OUTPUT_BUDGET_BYTES = 38_000;
const CHILD_OUTPUT_BUDGET_BYTES = 8 * 1024 * 1024;
const fields = (...names) => new Set(["action", "host", ...names]);
const ACTION_FIELDS = {
	help: fields(),
	start: fields(),
	tabs: fields("query", "offset"),
	open: fields("ref_id", "url", "lineno", "response_length"),
	find: fields("ref_id", "pattern", "lineno", "response_length"),
	click: fields("ref_id", "id", "selector", "x", "y"),
	type: fields("ref_id", "id", "text"),
	screenshot: fields("ref_id", "id", "selector"),
	html: fields("ref_id", "id", "selector"),
	navigate: fields("ref_id", "url"),
	evaluate: fields("ref_id", "expression"),
	network: fields("ref_id"),
	load_all: fields("ref_id", "selector", "interval_ms"),
	raw: fields("ref_id", "method", "params"),
	read_result: fields("handle", "offset"),
	discard_result: fields("handle"),
	stop: fields("ref_id"),
};
const OPERATION_ORDER = [
	"start", "tabs", "navigate", "open", "find", "click", "type",
	"screenshot", "html", "evaluate", "network", "load_all", "raw",
	"read_result", "discard_result", "stop",
];
const BATCH_FIELDS = new Set(["host", "response_length", ...OPERATION_ORDER]);

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function optionalString(value, field) {
	if (value === undefined) return undefined;
	return requiredString(value, field);
}

function parseHost(value) {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !HOSTS.has(value)) {
		if (HOSTS.size === 0) throw new Error("SSH browser routing is disabled");
		throw new Error(`host must be one of: ${[...HOSTS].join(", ")}`);
	}
	return value;
}

function parseOffset(value, field = "offset", fallback = 0) {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 0)
		throw new Error(`${field} must be a non-negative integer`);
	return value;
}

function parseLine(value) {
	const line = parseOffset(value, "lineno", 1);
	if (line < 1) throw new Error("lineno must be at least 1");
	return line;
}

function parseElementId(value) {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1)
		throw new Error("id must be a positive integer from open/find");
	return value;
}

function parseResponseLength(value) {
	if (value === undefined) return "medium";
	if (!RESPONSE_LENGTHS.has(value))
		throw new Error("response_length must be one of: short, medium, long");
	return value;
}

function parseHandle(value) {
	const handle = requiredString(value, "handle");
	if (!/^[a-f0-9-]{36}$/.test(handle)) throw new Error("handle is invalid");
	return handle;
}

function parseRef(value) {
	return requiredString(value, "ref_id");
}

function parseActionRequest(text) {
	if (text.trim() === "help") return { action: "help" };
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`input must be "help" or valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isObject(value)) throw new Error("input must be a JSON object");
	if (typeof value.action !== "string" || !Object.hasOwn(ACTION_FIELDS, value.action))
		throw new Error(`action must be one of: ${Object.keys(ACTION_FIELDS).join(", ")}`);
	const unknown = Object.keys(value).filter(
		(key) => !ACTION_FIELDS[value.action].has(key),
	);
	if (unknown.length)
		throw new Error(`unknown ${value.action} field(s): ${unknown.join(", ")}`);
	const host = parseHost(value.host);
	const routed = (request) => (host ? { ...request, host } : request);

	if (["help", "start"].includes(value.action)) return routed({ action: value.action });
	if (value.action === "tabs")
		return routed({
			action: "tabs",
			...(optionalString(value.query, "query") ? { query: value.query.trim() } : {}),
			offset: parseOffset(value.offset),
		});
	if (value.action === "open") {
		const refId = optionalString(value.ref_id, "ref_id");
		const url = optionalString(value.url, "url");
		if (Boolean(refId) === Boolean(url)) throw new Error("open requires exactly one of ref_id or url");
		return routed(url
			? { action: "open", url }
			: {
				action: "open",
				ref_id: refId,
				lineno: parseLine(value.lineno),
				response_length: parseResponseLength(value.response_length),
			});
	}
	if (value.action === "find")
		return routed({
			action: "find",
			ref_id: parseRef(value.ref_id),
			pattern: requiredString(value.pattern, "pattern"),
			lineno: parseLine(value.lineno),
			response_length: parseResponseLength(value.response_length),
		});
	if (value.action === "read_result")
		return routed({ action: "read_result", handle: parseHandle(value.handle), offset: parseOffset(value.offset) });
	if (value.action === "discard_result")
		return routed({ action: "discard_result", handle: parseHandle(value.handle) });
	if (value.action === "stop")
		return routed({
			action: "stop",
			...(optionalString(value.ref_id, "ref_id") ? { ref_id: value.ref_id.trim() } : {}),
		});

	const refId = parseRef(value.ref_id);
	if (value.action === "network") return routed({ action: "network", ref_id: refId });
	if (value.action === "navigate")
		return routed({ action: "navigate", ref_id: refId, url: requiredString(value.url, "url") });
	if (value.action === "evaluate")
		return routed({ action: "evaluate", ref_id: refId, expression: requiredString(value.expression, "expression") });
	if (value.action === "click") {
		const id = parseElementId(value.id);
		const selector = optionalString(value.selector, "selector");
		const hasX = value.x !== undefined;
		const hasY = value.y !== undefined;
		if (hasX !== hasY) throw new Error("click coordinates require both x and y");
		if (hasX && (![value.x, value.y].every(item => typeof item === "number" && Number.isFinite(item))))
			throw new Error("x and y must be finite CSS-pixel numbers");
		const modes = Number(id !== undefined) + Number(Boolean(selector)) + Number(hasX);
		if (modes !== 1) throw new Error("click requires exactly one of id, selector, or x+y");
		return routed({ action: "click", ref_id: refId, ...(id ? { id } : {}), ...(selector ? { selector } : {}), ...(hasX ? { x: value.x, y: value.y } : {}) });
	}
	if (value.action === "type") {
		if (typeof value.text !== "string" || value.text.length === 0)
			throw new Error("text must be a non-empty string");
		const id = parseElementId(value.id);
		return routed({ action: "type", ref_id: refId, ...(id ? { id } : {}), text: value.text });
	}
	if (value.action === "screenshot" || value.action === "html") {
		const id = parseElementId(value.id);
		const selector = optionalString(value.selector, "selector");
		if (id && selector) throw new Error(`${value.action} accepts id or selector, not both`);
		return routed({ action: value.action, ref_id: refId, ...(id ? { id } : {}), ...(selector ? { selector } : {}) });
	}
	if (value.action === "load_all") {
		const interval = value.interval_ms ?? 1500;
		if (!Number.isInteger(interval) || interval < 0 || interval > 60_000)
			throw new Error("interval_ms must be an integer from 0 to 60000");
		return routed({ action: "load_all", ref_id: refId, selector: requiredString(value.selector, "selector"), interval_ms: interval });
	}
	if (value.action === "raw") {
		if (value.params !== undefined && !isObject(value.params))
			throw new Error("params must be an object when provided");
		return routed({ action: "raw", ref_id: refId, method: requiredString(value.method, "method"), params: value.params ?? {} });
	}
	throw new Error(`unsupported action: ${value.action}`);
}

export function parseRequest(text) {
	if (text.trim() === "help") return { help: true };
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`input must be "help" or valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isObject(value)) throw new Error("input must be a JSON object");
	const unknown = Object.keys(value).filter(key => !BATCH_FIELDS.has(key));
	if (unknown.length) throw new Error(`unknown browser field(s): ${unknown.join(", ")}`);
	const host = parseHost(value.host);
	const responseLength = parseResponseLength(value.response_length);
	const operations = [];
	for (const action of OPERATION_ORDER) {
		if (value[action] === undefined) continue;
		if (!Array.isArray(value[action]) || value[action].length === 0)
			throw new Error(`${action} must be a non-empty array`);
		for (const [index, item] of value[action].entries()) {
			if (!isObject(item)) throw new Error(`${action}[${index}] must be an object`);
			const reserved = ["action", "host", "response_length"].filter(key => Object.hasOwn(item, key));
			if (reserved.length) throw new Error(`${action}[${index}] has top-level field(s): ${reserved.join(", ")}`);
			const parsed = parseActionRequest(JSON.stringify({
				action,
				...item,
				...(["open", "find"].includes(action) ? { response_length: responseLength } : {}),
			}));
			operations.push(parsed);
		}
	}
	if (operations.length === 0) throw new Error(`provide at least one operation: ${OPERATION_ORDER.join(", ")}`);
	return { operations, ...(host ? { host } : {}) };
}

function canonicalHost(value) {
	const short = value.split(".")[0];
	return HOST_ALIASES.get(value) ?? HOST_ALIASES.get(short) ?? short;
}

export function planHostRoute(request, currentHostname = hostname()) {
	const { host, ...localRequest } = request;
	if (!host) return { remote: false, request: localRequest };
	return { host, remote: canonicalHost(currentHostname) !== host, request: localRequest };
}

function artifactDir() {
	return process.env.XDG_RUNTIME_DIR
		? join(process.env.XDG_RUNTIME_DIR, "browser-tool")
		: join(tmpdir(), `browser-tool-${process.getuid?.() ?? "user"}`);
}

async function artifactPath(request) {
	await mkdir(artifactDir(), { recursive: true, mode: 0o700 });
	const suffix = request.id ? `-element-${request.id}` : request.selector ? "-element" : "";
	const safeRef = request.ref_id.slice(0, 12).replace(/[^A-Za-z0-9_-]/g, "_");
	return join(artifactDir(), `browser-${safeRef}${suffix}-${crypto.randomUUID()}.png`);
}

export async function cliInvocation(request) {
	switch (request.action) {
		case "start": return { args: ["start"] };
		case "tabs": return { args: ["tabsjson"] };
		case "open": return request.url
			? { args: ["open", request.url] }
			: { args: ["snap", request.ref_id, String(request.lineno), request.response_length] };
		case "find": return { args: ["find", request.ref_id, request.pattern, String(request.lineno), request.response_length] };
		case "evaluate": return { args: ["eval", request.ref_id, request.expression] };
		case "screenshot": {
			const file = await artifactPath(request);
			return {
				args: request.id
					? ["shotref", request.ref_id, String(request.id), file]
					: request.selector
						? ["shotel", request.ref_id, request.selector, file]
						: ["shot", request.ref_id, file],
				file,
			};
		}
		case "html": return {
			args: request.id
				? ["htmlref", request.ref_id, String(request.id)]
				: ["html", request.ref_id, ...(request.selector ? [request.selector] : [])],
		};
		case "navigate": return { args: ["nav", request.ref_id, request.url] };
		case "network": return { args: ["net", request.ref_id] };
		case "click": return {
			args: request.id
				? ["clickref", request.ref_id, String(request.id)]
				: request.selector
					? ["click", request.ref_id, request.selector]
					: ["clickxy", request.ref_id, String(request.x), String(request.y)],
		};
		case "type": return { args: request.id
			? ["typeref", request.ref_id, String(request.id), request.text]
			: ["type", request.ref_id, request.text] };
		case "load_all": return { args: ["loadall", request.ref_id, request.selector, String(request.interval_ms)] };
		case "raw": return { args: ["evalraw", request.ref_id, request.method, JSON.stringify(request.params)] };
		case "stop": return { args: ["stop", ...(request.ref_id ? [request.ref_id] : [])] };
		default: throw new Error(`cannot execute action: ${request.action}`);
	}
}

export async function runProgram(command, args, input) {
	const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	let outputBytes = 0;
	let outputLimitExceeded = false;
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	const append = (current, chunk) => {
		if (outputLimitExceeded) return current;
		outputBytes += Buffer.byteLength(chunk);
		if (outputBytes > CHILD_OUTPUT_BUDGET_BYTES) {
			outputLimitExceeded = true;
			child.kill("SIGKILL");
			return current;
		}
		return current + chunk;
	};
	child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
	child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
	const forward = signal => { if (!child.killed) child.kill(signal); };
	process.once("SIGINT", forward);
	process.once("SIGTERM", forward);
	try {
		if (input !== undefined) child.stdin.end(input);
		const code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", value => resolve(value ?? 1));
		});
		if (outputLimitExceeded)
			throw new Error("browser child output exceeded 8 MiB; narrow the operation and retry");
		return { code, stdout: stdout.trim(), stderr: stderr.trim() };
	} finally {
		process.off("SIGINT", forward);
		process.off("SIGTERM", forward);
	}
}

function cleanFailure(value) {
	return value.replace(/^(?:browser:\s*)+/, "").replace(/^Error:\s*/, "");
}

function resultPath(handle) {
	return join(artifactDir(), `result-${handle}.txt`);
}

export async function pruneResultCache(now = Date.now()) {
	let names;
	try {
		names = await readdir(artifactDir());
	} catch (error) {
		if (error?.code === "ENOENT") return 0;
		throw error;
	}
	let removed = 0;
	for (const name of names.filter(item => /^(?:result-[a-f0-9-]{36}\.txt|(?:[A-Za-z0-9_.-]+-)?browser-.*\.png)$/.test(item))) {
		const path = join(artifactDir(), name);
		try {
			const maxAge = name.startsWith("result-") ? RESULT_TTL_MS : SCREENSHOT_TTL_MS;
			if (now - (await stat(path)).mtimeMs > maxAge) {
				await rm(path, { force: true });
				removed++;
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return removed;
}

async function cacheResult(value) {
	const handle = crypto.randomUUID();
	await mkdir(artifactDir(), { recursive: true, mode: 0o700 });
	await writeFile(resultPath(handle), value, { mode: 0o600 });
	return handle;
}

function chunkForJson(value, offset = 0, budget = TEXT_BUDGET_BYTES) {
	let bytes = 2;
	let end = offset;
	for (const character of value.slice(offset)) {
		const next = Buffer.byteLength(JSON.stringify(character)) - 2;
		if (bytes + next > budget) break;
		bytes += next;
		end += character.length;
	}
	return { text: value.slice(offset, end), end };
}

async function withLimitedText(base, field, value) {
	const chunk = chunkForJson(value);
	if (chunk.end >= value.length) return { ...base, [field]: value };
	const handle = await cacheResult(value);
	return {
		...base,
		[field]: chunk.text,
		truncated: true,
		omitted_chars: value.length - chunk.end,
		result_handle: handle,
		next_offset: chunk.end,
	};
}

export async function readCachedResult(request) {
	let value;
	try {
		value = await readFile(resultPath(request.handle), "utf8");
	} catch (error) {
		if (error?.code === "ENOENT")
			throw new Error(`result handle not found: ${request.handle}; check the host or rerun the original action`);
		throw error;
	}
	if (request.offset > value.length)
		throw new Error(`offset ${request.offset} exceeds result length ${value.length}`);
	const chunk = chunkForJson(value, request.offset);
	const complete = chunk.end >= value.length;
	if (complete) await rm(resultPath(request.handle), { force: true });
	return {
		handle: request.handle,
		offset: request.offset,
		text: chunk.text,
		complete,
		...(!complete ? { next_offset: chunk.end } : {}),
	};
}

async function discardCachedResult(handle) {
	await rm(resultPath(handle), { force: true });
	return { discarded: handle };
}

function boundPage(page) {
	const base = {
		ref_id: page.ref_id,
		title: page.title,
		url: page.url,
		lineno: page.lineno,
		...(page.pattern ? { pattern: page.pattern } : {}),
	};
	const elements = new Map((page.elements || []).map(element => [element.id, element]));
	const content = [];
	const includedElements = [];
	const includedIds = new Set();
	for (const line of page.content || []) {
		const nextContent = [...content, line];
		const nextElements = [...includedElements];
		if (line.element_id && !includedIds.has(line.element_id) && elements.has(line.element_id))
			nextElements.push(elements.get(line.element_id));
		const candidate = { ...base, content: nextContent, elements: nextElements };
		if (Buffer.byteLength(JSON.stringify(candidate)) > OUTPUT_BUDGET_BYTES) break;
		content.push(line);
		if (line.element_id && !includedIds.has(line.element_id) && elements.has(line.element_id)) {
			includedIds.add(line.element_id);
			includedElements.push(elements.get(line.element_id));
		}
	}
	const omitted = content.length < (page.content || []).length;
	return {
		...base,
		content,
		elements: includedElements,
		...((omitted || page.next_lineno)
			? { truncated: true, next_lineno: omitted ? page.lineno + content.length : page.next_lineno }
			: {}),
	};
}

function parseJsonOutput(stdout, action) {
	try {
		return JSON.parse(stdout);
	} catch (error) {
		throw new Error(`${action} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function formatLocalResult(request, stdout, file) {
	if (request.action === "tabs") {
		let tabs = parseJsonOutput(stdout, "tabs");
		if (!Array.isArray(tabs)) throw new Error("tabs result is not an array");
		if (request.query) {
			const query = request.query.toLowerCase();
			tabs = tabs.filter(tab => `${tab.title}\n${tab.url}`.toLowerCase().includes(query));
		}
		if (request.offset > tabs.length)
			throw new Error(`offset ${request.offset} exceeds tab count ${tabs.length}`);
		const kept = [];
		for (const tab of tabs.slice(request.offset)) {
			const compact = {
				ref_id: tab.ref_id,
				title: String(tab.title || "").slice(0, 500),
				url: String(tab.url || "").slice(0, 8_000),
			};
			if (Buffer.byteLength(JSON.stringify({ tabs: [...kept, compact] })) > OUTPUT_BUDGET_BYTES) break;
			kept.push(compact);
		}
		const remaining = tabs.length - request.offset - kept.length;
		return {
			offset: request.offset,
			tabs: kept,
			...(remaining > 0 ? { truncated: true, omitted_tabs: remaining, next_offset: request.offset + kept.length } : {}),
		};
	}
	if (request.action === "open" && request.ref_id)
		return boundPage({ ...parseJsonOutput(stdout, "open"), ref_id: request.ref_id });
	if (request.action === "find")
		return boundPage({ ...parseJsonOutput(stdout, "find"), ref_id: request.ref_id });
	if (request.action === "open" && request.url) {
		const match = stdout.match(/^Opened new tab: (\S+)\s+/);
		if (!match) throw new Error(`could not parse opened tab: ${stdout}`);
		return { ref_id: match[1], url: request.url };
	}
	if (request.action === "screenshot") {
		const dpr = Number(stdout.match(/Device pixel ratio \(DPR\): ([0-9.]+)/)?.[1]);
		return {
			ref_id: request.ref_id,
			...(request.id ? { id: request.id } : {}),
			...(request.selector ? { selector: request.selector } : {}),
			file,
			...(Number.isFinite(dpr) ? { dpr } : {}),
			coordinates: "CSS pixels; screenshot pixels / DPR",
		};
	}
	if (request.action === "evaluate") return withLimitedText({ ref_id: request.ref_id }, "value", stdout);
	if (request.action === "html") return withLimitedText({ ref_id: request.ref_id }, "html", stdout);
	if (request.action === "network") return withLimitedText({ ref_id: request.ref_id }, "entries", stdout);
	if (request.action === "raw") return withLimitedText({ ref_id: request.ref_id }, "result", stdout);
	if (request.action === "stop") return { stopped: request.ref_id ?? "all tab daemons" };
	return { ...(request.ref_id ? { ref_id: request.ref_id } : {}), result: stdout || "ok" };
}

export function browserHelp() {
	const sshEnabled = HOSTS.size > 0 && typeof REMOTE_TOOL_PATH === "string";
	return {
		call: `await tools.browser(JSON.stringify({ ${sshEnabled ? "host?, " : ""}response_length?, tabs?, open?, find?, click?, ... }))`,
		...(sshEnabled ? { host: `optional ${[...HOSTS].join(" | ")}` } : {}),
		batching: "operations are non-empty arrays; independent items may share one call; dependent steps use separate calls",
		actions: {
			tabs: "[{query?, offset?}] -> ref_id/title/url",
			open: "[{ref_id, lineno?} inspect | {url} new tab]",
			find: "[{ref_id, pattern, lineno?}]",
			click: "[{ref_id, id | selector | x+y}]",
			type: "[{ref_id, text, id?}]; id focuses first",
			screenshot: "[{ref_id, id? | selector?}] -> local file",
			navigate: "[{ref_id, url}]",
			html: "[{ref_id, id? | selector?}]",
			evaluate: "[{ref_id, expression}]",
			network: "[{ref_id}]",
			load_all: "[{ref_id, selector, interval_ms?}]",
			raw: "[{ref_id, method, params?}]",
			start: "[{}]",
			stop: "[{ref_id?}]",
			read_result: "[{handle, offset}]; same host",
			discard_result: "[{handle}]; same host",
		},
		notes: [
			"Prefer tabs -> open -> click/type; ref_id/id/lineno follow web__run vocabulary",
			"Continue with next_lineno or next_offset; top-level response_length is short|medium|long",
			"Ask before unfamiliar low-trust navigation or consequential external actions unless already authorized",
			"Never close the shared browser after a task",
		],
	};
}

async function executeOperation(request) {
	if (request.action === "read_result") return readCachedResult(request);
	if (request.action === "discard_result") return discardCachedResult(request.handle);
	const invocation = await cliInvocation(request);
	const result = await runProgram(process.execPath, [CDP_PATH, ...invocation.args]);
	if (result.code !== 0)
		throw new Error(cleanFailure(result.stderr || result.stdout || `browser command exited with code ${result.code}`));
	return await formatLocalResult(request, result.stdout, invocation.file);
}

async function executeBatch(request) {
	const results = [];
	for (const [index, operation] of request.operations.entries()) {
		try {
			results.push(await executeOperation(operation));
		} catch (error) {
			throw new Error(
				`batch failed at ${operation.action}[${index}] after ${results.length} completed operation(s): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (results.length === 1) return results[0];
	return {
		results: results.map((result, index) => ({
			operation: request.operations[index].action,
			index,
			...result,
		})),
	};
}

async function copyRemoteArtifact(host, remoteFile) {
	if (!/^\/[A-Za-z0-9_./-]+$/.test(remoteFile))
		throw new Error(`remote browser returned an unsafe artifact path: ${remoteFile}`);
	await mkdir(artifactDir(), { recursive: true, mode: 0o700 });
	const localFile = join(artifactDir(), `${host}-${basename(remoteFile)}`);
	const copied = await runProgram("scp", ["-q", `${host}:${remoteFile}`, localFile]);
	if (copied.code !== 0)
		throw new Error(copied.stderr || copied.stdout || "could not copy remote screenshot");
	const removed = await runProgram("ssh", [host, `/usr/bin/rm -- ${remoteFile}`]);
	if (removed.code !== 0) await rm(localFile, { force: true });
	if (removed.code !== 0)
		throw new Error(removed.stderr || removed.stdout || "copied screenshot but could not remove remote artifact");
	return localFile;
}

async function runRemote(host, request) {
	if (!REMOTE_TOOL_PATH)
		throw new Error("SSH browser routing requires REMOTE_TOOL_PATH");
	const result = await runProgram("ssh", [host, `/usr/bin/node ${REMOTE_TOOL_PATH} --parsed`], JSON.stringify(request));
	if (result.code !== 0)
		throw new Error(cleanFailure(result.stderr || result.stdout || `remote browser exited with code ${result.code}`));
	const parsed = parseJsonOutput(result.stdout, "remote browser");
	if (!isObject(parsed)) throw new Error("remote browser result is not an object");
	const screenshotIndexes = request.operations
		.map((operation, index) => operation.action === "screenshot" ? index : -1)
		.filter(index => index >= 0);
	for (const index of screenshotIndexes) {
		const result = request.operations.length === 1 ? parsed : parsed.results?.[index];
		if (!isObject(result) || typeof result.file !== "string")
			throw new Error(`remote screenshot result ${index} has no file path`);
		result.file = await copyRemoteArtifact(host, result.file);
	}
	return parsed;
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const input = await readStdin();
	const request = process.argv[2] === "--parsed" ? JSON.parse(input) : parseRequest(input);
	await pruneResultCache();
	if (request.help) {
		process.stdout.write(`${JSON.stringify(browserHelp())}\n`);
		return;
	}
	const route = planHostRoute(request);
	const result = !route.remote
		? await executeBatch(route.request)
		: await runRemote(route.host, route.request);
	process.stdout.write(`${JSON.stringify(route.host ? { host: route.host, ...result } : result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	main().catch(error => {
		process.stderr.write(`browser: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
