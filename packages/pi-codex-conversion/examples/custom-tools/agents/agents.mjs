#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { coordinate } from "./coordination.mjs";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(TOOL_DIR, "profiles");
const SPAWN_FIELDS = new Set([
	"action",
	"agent_type",
	"label",
	"name",
	"message",
	"cwd",
	"base",
	"blocking",
	"host",
]);
const FIND_FIELDS = new Set(["action", "query", "host"]);
const SEND_FIELDS = new Set([
	"action",
	"target",
	"message",
	"blocking",
	"host",
]);
const READ_FIELDS = new Set(["action", "target", "host"]);
const ANSWER_FIELDS = new Set(["action", "target", "answers", "host"]);
const INTERNAL_WAIT_MS = 1_800_000;
const MAX_OUTPUT_CHARS = 64 * 1024;
const HOSTS = new Set(["desktop", "laptop", "server"]);
const HOST_ALIASES = new Map([
	["desktop", "desktop"],
	["laptop", "laptop"],
	["server", "server"],
]);
const REMOTE_SOCKET_PATH = process.env.AGENTS_REMOTE_SOCKET_PATH;
const REMOTE_AGENTS_PATH = process.env.AGENTS_REMOTE_TOOL_PATH;

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function optionalHost(value) {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !HOSTS.has(value))
		throw new Error("host must be one of: desktop, laptop, server");
	return value;
}

function parseSpawnRequest(value) {
	const unknown = Object.keys(value).filter((key) => !SPAWN_FIELDS.has(key));
	if (unknown.length)
		throw new Error(`unknown spawn field(s): ${unknown.join(", ")}`);
	const label = requiredString(value.label, "label");
	const words = label.split(/\s+/u);
	if (words.length < 2 || words.length > 3)
		throw new Error("label must contain 2 or 3 words");
	if (value.blocking !== undefined && typeof value.blocking !== "boolean")
		throw new Error("blocking must be a boolean when provided");
	return {
		action: "spawn",
		agent_type: requiredString(value.agent_type, "agent_type"),
		label,
		name: requiredString(value.name, "name"),
		message: requiredString(value.message, "message"),
		...(value.cwd === undefined
			? {}
			: { cwd: requiredString(value.cwd, "cwd") }),
		...(value.base === undefined
			? {}
			: { base: requiredString(value.base, "base") }),
		blocking: value.blocking ?? true,
		...(optionalHost(value.host) ? { host: value.host } : {}),
	};
}

function parseSendRequest(value) {
	const unknown = Object.keys(value).filter((key) => !SEND_FIELDS.has(key));
	if (unknown.length)
		throw new Error(`unknown send field(s): ${unknown.join(", ")}`);
	if (value.blocking !== undefined && typeof value.blocking !== "boolean")
		throw new Error("blocking must be a boolean when provided");
	return {
		action: "send",
		target: requiredString(value.target, "target"),
		message: requiredString(value.message, "message"),
		blocking: value.blocking ?? true,
		...(value.host === undefined
			? {}
			: { host: requiredString(value.host, "host") }),
	};
}

function parseReadRequest(value) {
	const unknown = Object.keys(value).filter((key) => !READ_FIELDS.has(key));
	if (unknown.length)
		throw new Error(`unknown read field(s): ${unknown.join(", ")}`);
	return {
		action: "read",
		target: requiredString(value.target, "target"),
		...(value.host === undefined
			? {}
			: { host: requiredString(value.host, "host") }),
	};
}

function parseAnswerRequest(value) {
	const unknown = Object.keys(value).filter((key) => !ANSWER_FIELDS.has(key));
	if (unknown.length)
		throw new Error(`unknown answer field(s): ${unknown.join(", ")}`);
	if (!Array.isArray(value.answers)) throw new Error("answers must be an array");
	return {
		action: "answer",
		target: requiredString(value.target, "target"),
		answers: value.answers,
		...(value.host === undefined
			? {}
			: { host: requiredString(value.host, "host") }),
	};
}

function parseRequest(text) {
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
	if (value.action === "help") return { action: "help" };
	if (value.action === "spawn") return parseSpawnRequest(value);
	if (value.action === "send") return parseSendRequest(value);
	if (value.action === "read") return parseReadRequest(value);
	if (value.action === "answer") return parseAnswerRequest(value);
	if (value.action === "wait")
		throw new Error("unknown action wait; use read to collect background work");
	if (value.action === "find") {
		const unknown = Object.keys(value).filter((key) => !FIND_FIELDS.has(key));
		if (unknown.length)
			throw new Error(`unknown find field(s): ${unknown.join(", ")}`);
	}
	if (value.action !== "find")
		throw new Error("action must be one of: help, spawn, find, send, read, answer");
	return {
		action: "coordinate",
		raw: text,
		...(typeof value.target === "string" && value.target.trim()
			? { target: value.target.trim() }
			: {}),
	};
}

async function run(command, args, options = {}) {
	return await new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (stdout.length > MAX_OUTPUT_CHARS) child.kill("SIGTERM");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (stderr.length > MAX_OUTPUT_CHARS) child.kill("SIGTERM");
		});
		child.once("error", rejectRun);
		child.once("close", (code, signal) => {
			if (stdout.length > MAX_OUTPUT_CHARS || stderr.length > MAX_OUTPUT_CHARS)
				return rejectRun(new Error(`${command} output exceeded ${MAX_OUTPUT_CHARS} characters`));
			if (code === 0) return resolveRun({ stdout: stdout.trim(), stderr: stderr.trim() });
			const reason = stderr.trim() || stdout.trim() || (signal ? `signal ${signal}` : `exit ${code}`);
			rejectRun(new Error(`${command}: ${reason}`));
		});
		child.stdin.end(options.input ?? "");
	});
}

async function runJson(command, args, options) {
	const result = await run(command, args, options);
	try {
		return JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(
			`${command} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function validateStringArray(value, field) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item))
		throw new Error(`${field} must be an array of non-empty strings`);
	return value;
}

async function loadProfiles() {
	const entries = await readdir(PROFILES_DIR, { withFileTypes: true });
	const profiles = new Map();
	for (const entry of entries.filter((item) => item.isDirectory())) {
		if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(entry.name))
			throw new Error(`invalid agent profile directory: ${entry.name}`);
		const dir = join(PROFILES_DIR, entry.name);
		let profile;
		try {
			profile = JSON.parse(await readFile(join(dir, "profile.json"), "utf8"));
		} catch (error) {
			throw new Error(
				`invalid ${entry.name} profile: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!isObject(profile)) throw new Error(`${entry.name} profile must be an object`);
		const allowed = new Set([
			"description",
			"model",
			"thinking",
			"prompt",
			"prepare",
			"accepts",
			"pi_args",
		]);
		const unknown = Object.keys(profile).filter((key) => !allowed.has(key));
		if (unknown.length)
			throw new Error(`unknown ${entry.name} profile field(s): ${unknown.join(", ")}`);
		const prompt = resolve(dir, requiredString(profile.prompt, `${entry.name}.prompt`));
		if (!(await stat(prompt)).isFile()) throw new Error(`${entry.name}.prompt is not a file`);
		const prepare = profile.prepare
			? resolve(dir, requiredString(profile.prepare, `${entry.name}.prepare`))
			: undefined;
		if (prepare && !(await stat(prepare)).isFile())
			throw new Error(`${entry.name}.prepare is not a file`);
		profiles.set(entry.name, {
			name: entry.name,
			description: requiredString(profile.description, `${entry.name}.description`),
			model: requiredString(profile.model, `${entry.name}.model`),
			thinking: requiredString(profile.thinking, `${entry.name}.thinking`),
			prompt,
			prepare,
			accepts: profile.accepts ? validateStringArray(profile.accepts, `${entry.name}.accepts`) : [],
			pi_args: profile.pi_args ? validateStringArray(profile.pi_args, `${entry.name}.pi_args`) : [],
		});
	}
	return profiles;
}

async function resolveCwd(value) {
	const cwd = value ? (isAbsolute(value) ? value : resolve(process.cwd(), value)) : process.cwd();
	try {
		if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`cwd is not a directory: ${cwd}`);
	}
	return cwd;
}

function slugify(label) {
	let slug = label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	if (!/^[a-z]/u.test(slug)) slug = `agent-${slug}`;
	return slug.slice(0, 32).replace(/-+$/u, "") || "agent";
}

function uniqueName(label, names) {
	const base = slugify(label);
	if (!names.has(base)) return { name: base, suffix: 1 };
	for (let suffix = 2; suffix < 10_000; suffix += 1) {
		const tail = `-${suffix}`;
		const candidate = `${base.slice(0, 32 - tail.length).replace(/-+$/u, "")}${tail}`;
		if (!names.has(candidate)) return { name: candidate, suffix };
	}
	throw new Error(`could not allocate an agent name for ${JSON.stringify(label)}`);
}

function herdrResult(value, command) {
	if (!isObject(value) || !isObject(value.result))
		throw new Error(`${command} returned no result`);
	return value.result;
}

function publicResult(result, preferredTarget) {
	if (Array.isArray(result.panels))
		return {
			...(result.host ? { host: result.host } : {}),
			agents: result.panels.map(({ id, ...agent }) => ({ target: id, ...agent })),
		};
	const {
		pane,
		mode: _mode,
		delivery: _delivery,
		status,
		text: reply,
		session_changed: sessionChanged,
		transcript_pending: replyPending,
		pending: _pending,
		...visible
	} = result;
	const target = preferredTarget ?? pane;
	const settled = status === "done" || status === "idle";
	const blocked = status === "blocked";
	return {
		...(target ? { target } : {}),
		...visible,
		...(!settled && status ? { status } : {}),
		...(reply !== undefined ? { reply } : {}),
		...(sessionChanged ? { agent_changed: true } : {}),
		...(replyPending ? { reply_pending: true } : {}),
		...(blocked
			? {
					next: result.ask?.handoff
						? "Ask the user to complete the action, then call read."
						: "Use answer directly when possible. Ask the user only when their decision is required.",
				}
			: {}),
		...(visible.sent
			? {
					next: {
						when: "Before answering if the result belongs to the user's request",
						request: {
							action: "read",
							target,
							...(result.host ? { host: result.host } : {}),
						},
					},
				}
			: {}),
	};
}

async function closeTab(tabId) {
	await runJson("herdr", ["tab", "close", tabId]);
}

async function closeWorkspace(workspaceId) {
	await runJson("herdr", ["workspace", "close", workspaceId]);
}

async function prepareMessage(profile, request, cwd) {
	const unsupported = request.base && !profile.accepts.includes("base") ? ["base"] : [];
	if (unsupported.length)
		throw new Error(`${unsupported.join(", ")} is not supported by ${profile.name}`);
	if (!profile.prepare) return request.message;
	const module = await import(`${pathToFileURL(profile.prepare).href}?mtime=${Date.now()}`);
	if (typeof module.prepare !== "function")
		throw new Error(`${profile.name}.prepare must export prepare()`);
	return await module.prepare({ cwd, message: request.message, base: request.base });
}

async function waitUntilSettled(target, host) {
	for (;;) {
		const result = await coordinate(
			JSON.stringify({
				action: "wait",
				target,
				timeout_ms: INTERNAL_WAIT_MS,
				...(host ? { host } : {}),
			}),
			{ exactTargets: true },
		);
		if (!result.timed_out) return result;
	}
}

async function deliver({ target, message, blocking, host }) {
	const result = await coordinate(
		JSON.stringify({
			action: "send",
			target,
			text: message,
			wait: blocking,
			...(blocking ? { timeout_ms: INTERNAL_WAIT_MS } : {}),
			...(host ? { host } : {}),
		}),
		{ exactTargets: true },
	);
	if (!result.timed_out) return result;
	return await waitUntilSettled(target, host);
}

async function send(request) {
	return publicResult(await deliver(request));
}

async function read(request) {
	for (;;) {
		const current = await coordinate(
			JSON.stringify({
				action: "read",
				target: request.target,
				source: "latest",
				...(request.host ? { host: request.host } : {}),
			}),
			{ exactTargets: true, includePending: true },
		);
		if (current.status === "blocked") return publicResult(current, request.target);
		if (!current.pending && current.status !== "working")
			return publicResult(current, request.target);
		if (current.status === "working") {
			const settled = await waitUntilSettled(request.target, request.host);
			if (settled.status === "blocked") return publicResult(settled, request.target);
		} else {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
		}
	}
}

async function answer(request) {
	const result = await coordinate(
		JSON.stringify({
			action: "answer",
			target: request.target,
			answers: request.answers,
			wait: true,
			timeout_ms: INTERNAL_WAIT_MS,
			...(request.host ? { host: request.host } : {}),
		}),
		{ exactTargets: true },
	);
	if (!result.timed_out) return publicResult(result, request.target);
	return publicResult(
		await waitUntilSettled(request.target, request.host),
		request.target,
	);
}

async function spawnAgent(request) {
	const remoteInvocation = process.env.AGENTS_REMOTE === "1";
	if (
		!remoteInvocation &&
		(process.env.HERDR_ENV !== "1" || !process.env.HERDR_WORKSPACE_ID)
	)
		throw new Error("spawn requires a managed agent workspace");
	const profiles = await loadProfiles();
	const profile = profiles.get(request.agent_type);
	if (!profile)
		throw new Error(
			`unknown agent_type ${JSON.stringify(request.agent_type)}; available: ${[...profiles.keys()].join(", ")}`,
		);
	const cwd = await resolveCwd(request.cwd);
	const message = await prepareMessage(profile, request, cwd);
	const list = herdrResult(await runJson("herdr", ["agent", "list"]), "herdr agent list");
	const names = new Set((list.agents ?? []).map((agent) => agent.name).filter(Boolean));
	const allocated = uniqueName(request.label, names);
	const label = allocated.suffix === 1 ? request.label : `${request.label} ${allocated.suffix}`;
	let tabId;
	let workspaceId;
	try {
		const created = remoteInvocation
			? herdrResult(
					await runJson("herdr", [
						"workspace",
						"create",
						"--cwd",
						cwd,
						"--label",
						label,
						"--no-focus",
					]),
					"herdr workspace create",
				)
			: herdrResult(
					await runJson("herdr", [
						"tab",
						"create",
						"--workspace",
						process.env.HERDR_WORKSPACE_ID,
						"--cwd",
						cwd,
						"--label",
						label,
						"--no-focus",
					]),
					"herdr tab create",
				);
		workspaceId = remoteInvocation ? created.workspace?.workspace_id : undefined;
		tabId = created.tab?.tab_id;
		const paneId = created.root_pane?.pane_id;
		if (!tabId || !paneId) throw new Error("herdr tab create returned no tab or pane id");
		await runJson(
			"herdr",
			[
				"agent",
				"start",
				allocated.name,
				"--kind",
				"pi",
				"--pane",
				paneId,
				"--timeout",
				"60000",
				"--",
				"--name",
				request.name,
				"--model",
				profile.model,
				"--thinking",
				profile.thinking,
				"--append-system-prompt",
				profile.prompt,
				...profile.pi_args,
			],
			{ cwd, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" } },
		);
		return publicResult(
			await deliver({
				target: allocated.name,
				message,
				blocking: request.blocking,
			}),
		);
	} catch (error) {
		if (workspaceId || tabId) {
			try {
				if (workspaceId) await closeWorkspace(workspaceId);
				else await closeTab(tabId);
			} catch (cleanupError) {
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}; cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
				);
			}
		}
		throw error;
	}
}

function canonicalHost(value) {
	return HOST_ALIASES.get(value.split(".")[0]);
}

async function routeSpawn(request) {
	const { host, ...localRequest } = request;
	if (!host || canonicalHost(hostname()) === host) {
		const result = await spawnAgent(localRequest);
		return host ? { host, ...result } : result;
	}
	const remoteRequest = {
		...localRequest,
		cwd: localRequest.cwd ?? process.cwd(),
	};
	if (!REMOTE_SOCKET_PATH || !REMOTE_AGENTS_PATH)
		throw new Error(
			"remote agents routing is not configured; set AGENTS_REMOTE_SOCKET_PATH and AGENTS_REMOTE_TOOL_PATH",
		);
	const remoteCommand = `HERDR_SOCKET_PATH=${REMOTE_SOCKET_PATH} AGENTS_REMOTE=1 /usr/bin/node ${REMOTE_AGENTS_PATH}`;
	const result = await runJson("ssh", [host, remoteCommand], {
		input: JSON.stringify(remoteRequest),
	});
	return { host, ...result };
}

async function help() {
	const profiles = await loadProfiles();
	return {
		prompting:
			"Specialists know their job. MUST provide only the concrete task and relevant context they cannot access, including session details and prior decisions. MUST stop after the task and inaccessible context. MUST NOT append generic method, evidence, or reporting instructions",
		reuse:
			"Reuse explorers only for the same investigation. General agents get follow-ups only on user request or to finish their assigned task. Keep reviewers independent. New scope gets a new agent",
		call: "await tools.agents(JSON.stringify(request))",
		common: "host?: desktop|laptop|server",
		actions: {
			spawn: "agent_type, label, name, message, cwd?, base?, blocking? (default true)",
			find: "query?",
			send: "target, message, blocking? (default true)",
			read: "target",
			answer: "target, answers",
		},
		notes: {
			label: "2-3 words",
			base: "Reviewer parent branch override, omit for normal baseline",
				target: "Exact value returned by spawn or find",
				answers: "[{selections?, other?, comment?}]",
			blocking:
				"true or omitted for requested findings, answers, or reviews, false only while continuing other work before read or when the user wants dispatch without waiting",
			},
		profiles: Object.fromEntries(
			[...profiles].map(([name, profile]) => [name, profile.description]),
		),
	};
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const input = await readStdin();
	const request = parseRequest(input);
	const result =
		request.action === "help"
			? await help()
			: request.action === "spawn"
				? await routeSpawn(request)
				: request.action === "send"
					? await send(request)
					: request.action === "read"
						? await read(request)
						: request.action === "answer"
							? await answer(request)
					: publicResult(
							await coordinate(request.raw, { exactTargets: true }),
							request.target,
						);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	main().catch((error) => {
		process.stderr.write(`agents: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});

export {
	help,
	loadProfiles,
	parseRequest,
	publicResult,
	resolveCwd,
	slugify,
	routeSpawn,
	uniqueName,
};
