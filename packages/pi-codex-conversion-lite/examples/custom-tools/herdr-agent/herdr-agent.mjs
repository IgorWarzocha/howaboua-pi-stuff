#!/usr/bin/env node

import { createConnection } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ACTION_FIELDS = {
	help: new Set(["action"]),
	find: new Set(["action", "query", "status", "include_self"]),
	send: new Set([
		"action",
		"target",
		"text",
		"queue",
		// Accepted for live sessions that cached the previous contract. New callers
		// use queue; prompt/steer are both Pi's context-sensitive submit action.
		"mode",
		"wait",
		"timeout_ms",
	]),
	wait: new Set(["action", "target", "timeout_ms"]),
	read: new Set(["action", "target", "source", "lines"]),
	answer: new Set(["action", "target", "answers", "wait", "timeout_ms"]),
};
const STATUSES = new Set(["blocked", "done", "idle", "unknown", "working"]);
const TERMINAL_STATUSES = new Set(["done", "idle"]);
const LEGACY_MODES = new Set(["auto", "prompt", "steer", "follow_up"]);
const SOURCES = new Set(["latest", "visible", "recent"]);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_TEXT_CHARS = 36_000;
// Pi can accept PTY input before the appended session message becomes readable.
// Leave enough time for that persistence lag before retrying the submit key.
const DELIVERY_TIMEOUT_MS = 5_000;
const STATUS_ORDER = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };
const AGENT_DIR =
	process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, field) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function optionalBoolean(value, field) {
	if (value !== undefined && typeof value !== "boolean")
		throw new Error(`${field} must be a boolean when provided`);
	return value;
}

function parseTimeout(value) {
	if (value === undefined) return DEFAULT_TIMEOUT_MS;
	if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS)
		throw new Error(`timeout_ms must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
	return value;
}

function parseAnswers(value) {
	if (!Array.isArray(value)) throw new Error("answers must be an array");
	return value.map((answer, index) => {
		if (!isObject(answer)) throw new Error(`answers[${index}] must be an object`);
		const allowed = new Set(["selections", "other", "comment"]);
		const unknown = Object.keys(answer).filter((key) => !allowed.has(key));
		if (unknown.length)
			throw new Error(`unknown answers[${index}] field(s): ${unknown.join(", ")}`);
		if (
			answer.selections !== undefined &&
			(!Array.isArray(answer.selections) ||
				answer.selections.some((item) => typeof item !== "string" || !item))
		)
			throw new Error(`answers[${index}].selections must be string labels`);
		for (const field of ["other", "comment"])
			if (answer[field] !== undefined && typeof answer[field] !== "string")
				throw new Error(`answers[${index}].${field} must be a string`);
		return {
			...(answer.selections ? { selections: answer.selections } : {}),
			...(answer.other !== undefined ? { other: answer.other } : {}),
			...(answer.comment !== undefined ? { comment: answer.comment } : {}),
		};
	});
}

export function parseRequest(text) {
	if (text.trim() === "help") return { action: "help" };
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`input must be \"help\" or valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isObject(value)) throw new Error("input must be a JSON object");
	if (
		typeof value.action !== "string" ||
		!Object.hasOwn(ACTION_FIELDS, value.action)
	)
		throw new Error(`action must be one of: ${Object.keys(ACTION_FIELDS).join(", ")}`);
	const unknown = Object.keys(value).filter(
		(key) => !ACTION_FIELDS[value.action].has(key),
	);
	if (unknown.length)
		throw new Error(`unknown ${value.action} field(s): ${unknown.join(", ")}`);
	if (value.action === "help") return { action: "help" };

	if (value.action === "find") {
		if (value.query !== undefined && typeof value.query !== "string")
			throw new Error("query must be a string when provided");
		if (value.status !== undefined && !STATUSES.has(value.status))
			throw new Error("status is invalid");
		return {
			action: "find",
			...(value.query?.trim() ? { query: value.query.trim() } : {}),
			...(value.status ? { status: value.status } : {}),
			include_self: optionalBoolean(value.include_self, "include_self") === true,
		};
	}

	const target = cleanString(value.target, "target");
	if (value.action === "wait")
		return { action: "wait", target, timeout_ms: parseTimeout(value.timeout_ms) };
	if (value.action === "read") {
		const source = value.source ?? "latest";
		if (!SOURCES.has(source)) throw new Error("source is invalid");
		const lines = value.lines ?? 40;
		if (!Number.isInteger(lines) || lines < 1 || lines > 200)
			throw new Error("lines must be an integer from 1 to 200");
		return { action: "read", target, source, lines };
	}
	if (value.action === "answer")
		return {
			action: "answer",
			target,
			answers: parseAnswers(value.answers),
			wait: optionalBoolean(value.wait, "wait") ?? true,
			timeout_ms: parseTimeout(value.timeout_ms),
		};

	if (value.mode !== undefined && !LEGACY_MODES.has(value.mode))
		throw new Error("mode is invalid");
	if (value.mode !== undefined && value.queue !== undefined)
		throw new Error("use queue or legacy mode, not both");
	const queue =
		optionalBoolean(value.queue, "queue") ?? value.mode === "follow_up";
	return {
		action: "send",
		target,
		text: cleanString(value.text, "text"),
		queue,
		wait: optionalBoolean(value.wait, "wait") ?? true,
		timeout_ms: parseTimeout(value.timeout_ms),
	};
}

class HerdrClient {
	constructor(socketPath = process.env.HERDR_SOCKET_PATH) {
		if (!socketPath)
			throw new Error(
				"HERDR_SOCKET_PATH is not set; run the calling Pi session inside Herdr",
			);
		this.socketPath = socketPath;
	}

	request(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = `herdr-agent:${crypto.randomUUID()}`;
			let buffer = "";
			let settled = false;
			const socket = createConnection(this.socketPath, () =>
				socket.write(`${JSON.stringify({ id, method, params })}\n`),
			);
			socket.setEncoding("utf8");
			const timer = setTimeout(
				() => finish(new Error(`Herdr ${method} timed out`)),
				10_000,
			);
			timer.unref();
			function finish(error, result) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				if (error) reject(error);
				else resolve(result);
			}
			socket.on("error", (error) => finish(error));
			socket.on("data", (chunk) => {
				buffer += chunk;
				if (buffer.length > 16 * 1024 * 1024)
					return finish(new Error(`Herdr ${method} response is too large`));
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				let response;
				try {
					response = JSON.parse(buffer.slice(0, newline));
				} catch (error) {
					return finish(new Error(`Herdr returned invalid JSON: ${error.message}`));
				}
				if (response.error)
					return finish(
						new Error(response.error.message || JSON.stringify(response.error)),
					);
				if (!("result" in response))
					return finish(new Error(`Herdr ${method} returned no result`));
				finish(undefined, response.result);
			});
		});
	}
}

function optionalString(value) {
	return typeof value === "string" ? value : undefined;
}

function parseAskChoice(value) {
	if (!isObject(value) || typeof value.label !== "string") return undefined;
	return {
		label: value.label,
		...(typeof value.description === "string"
			? { description: value.description }
			: {}),
	};
}

function parseAskPrompt(value) {
	if (!isObject(value) || typeof value.title !== "string") return undefined;
	return {
		title: value.title,
		multiple: value.multiple === true,
		choices: (Array.isArray(value.choices) ? value.choices : [])
			.map(parseAskChoice)
			.filter(Boolean),
		...(typeof value.body === "string" ? { body: value.body } : {}),
	};
}

function parseAskCall(part) {
	if (!isObject(part) || part.type !== "toolCall" || part.name !== "ask")
		return undefined;
	if (typeof part.id !== "string" || !isObject(part.arguments)) return undefined;
	const prompts = (Array.isArray(part.arguments.prompts)
		? part.arguments.prompts
		: []
	)
		.map(parseAskPrompt)
		.filter(Boolean);
	if (!prompts.length) return undefined;
	return {
		tool_call_id: part.id,
		handoff: part.arguments.handoff === true,
		prompts,
	};
}

export function parseSessionLines(lines) {
	const nodes = new Map();
	let leaf_id;
	for (const line of lines) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isObject(entry) || typeof entry.id !== "string") continue;
		const node = {
			parent_id: typeof entry.parentId === "string" ? entry.parentId : null,
			asks: [],
		};
		const message = entry.message;
		if (isObject(message) && message.role === "assistant") {
			const text = [];
			if (typeof message.content === "string") text.push(message.content);
			if (Array.isArray(message.content))
				for (const part of message.content) {
					if (isObject(part) && part.type === "text" && typeof part.text === "string")
						text.push(part.text);
					const ask = parseAskCall(part);
					if (ask) node.asks.push(ask);
				}
			node.assistant_entry = {
				id: entry.id,
				...(typeof message.stopReason === "string"
					? { stop_reason: message.stopReason }
					: {}),
			};
			const joined = text.join("");
			if (joined)
				node.assistant = {
					id: entry.id,
					text: joined,
					...(typeof message.stopReason === "string"
						? { stop_reason: message.stopReason }
						: {}),
				};
		}
		if (isObject(message) && message.role === "user") {
			const text = [];
			if (typeof message.content === "string") text.push(message.content);
			if (Array.isArray(message.content))
				for (const part of message.content)
					if (isObject(part) && part.type === "text" && typeof part.text === "string")
						text.push(part.text);
			const joined = text.join("");
			if (joined) node.user = { id: entry.id, text: joined };
		}
		if (
			isObject(message) &&
			(message.role === "toolResult" || message.role === "tool")
		)
			node.resolved_tool_call_id = optionalString(
				message.toolCallId ?? message.tool_call_id,
			);
		nodes.set(entry.id, node);
		leaf_id = entry.id;
	}

	let current = leaf_id;
	let assistant;
	let assistant_entry;
	let user;
	let ask;
	const resolved = new Set();
	const visited = new Set();
	while (current && !visited.has(current)) {
		visited.add(current);
		const node = nodes.get(current);
		if (!node) break;
		if (node.resolved_tool_call_id) resolved.add(node.resolved_tool_call_id);
		if (!ask)
			ask = [...node.asks]
				.reverse()
				.find((candidate) => !resolved.has(candidate.tool_call_id));
		assistant ??= node.assistant;
		assistant_entry ??= node.assistant_entry;
		user ??= node.user;
		current = node.parent_id;
	}
	return {
		leaf_id,
		assistant,
		assistant_entry,
		user,
		ask,
	};
}

class SessionReader {
	cache = new Map();

	async read(path) {
		if (!path) return { leaf_id: undefined };
		let metadata;
		try {
			metadata = await stat(path);
		} catch (error) {
			if (error?.code === "ENOENT") return { leaf_id: undefined, path };
			throw error;
		}
		const prior = this.cache.get(path);
		if (prior?.size === metadata.size && prior?.mtime_ms === metadata.mtimeMs)
			return prior.view;
		const text = await readFile(path, "utf8");
		const view = {
			...parseSessionLines(text.split("\n")),
			path,
			size: metadata.size,
			mtime_ms: metadata.mtimeMs,
		};
		this.cache.set(path, {
			size: metadata.size,
			mtime_ms: metadata.mtimeMs,
			view,
		});
		return view;
	}
}

async function getAgent(client, target) {
	return (await client.request("agent.get", { target })).agent;
}

async function getSnapshot(client) {
	return (await client.request("session.snapshot", {})).snapshot;
}

function enrichPanels(snapshot) {
	const tabs = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab.label]));
	const workspaces = new Map(
		snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]),
	);
	return (snapshot.agents.length ? snapshot.agents : snapshot.panes).map(
		(panel) => ({
			...panel,
			tab_label: tabs.get(panel.tab_id),
			workspace_label: workspaces.get(panel.workspace_id),
		}),
	);
}

function panelHaystack(panel) {
	return [
		panel.pane_id,
		panel.terminal_id,
		panel.name,
		panel.cwd,
		panel.foreground_cwd,
		panel.tab_label,
		panel.workspace_label,
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
}

async function findPanels(client, request) {
	const query = request.query?.toLowerCase();
	return enrichPanels(await getSnapshot(client))
		.filter((panel) => panel.agent === "pi")
		.filter(
			(panel) => request.include_self || panel.pane_id !== process.env.HERDR_PANE_ID,
		)
		.filter((panel) => !request.status || panel.agent_status === request.status)
		.filter((panel) => !query || panelHaystack(panel).includes(query))
		.sort(
			(a, b) =>
				STATUS_ORDER[a.agent_status] - STATUS_ORDER[b.agent_status] ||
				a.pane_id.localeCompare(b.pane_id),
		);
}

function compactPanel(panel) {
	return {
		id: panel.pane_id,
		status: panel.agent_status,
		cwd: panel.foreground_cwd,
		...(panel.name || panel.tab_label || panel.workspace_label
			? { label: panel.name || panel.tab_label || panel.workspace_label }
			: {}),
	};
}

async function resolvePanel(client, target) {
	let directError;
	try {
		const direct = await getAgent(client, target);
		if (direct.agent === "pi") return direct;
		directError = new Error(`${target} is not a Pi panel`);
	} catch (error) {
		directError = error;
	}
	const matches = await findPanels(client, {
		action: "find",
		query: target,
		include_self: true,
	});
	if (matches.length === 1) return matches[0];
	if (matches.length > 1)
		throw new Error(
			`ambiguous target ${JSON.stringify(target)}; candidates: ${matches
				.slice(0, 10)
				.map((panel) => panel.pane_id)
				.join(", ")}`,
		);
	throw directError instanceof Error
		? directError
		: new Error(`no Pi panel matches ${JSON.stringify(target)}`);
}

function assertRemote(panel) {
	if (panel.pane_id === process.env.HERDR_PANE_ID)
		throw new Error("refusing to target the calling Pi panel from its own tool call");
}

function sessionPath(panel) {
	return panel.agent_session?.kind === "path"
		? panel.agent_session.value
		: undefined;
}

async function terminalRead(client, target, source = "visible", lines = 40) {
	return (
		await client.request("agent.read", {
			target,
			source,
			format: "text",
			lines,
			strip_ansi: true,
		})
	).read.text;
}

export function isBusyScreen(text) {
	const tail = text.split("\n").slice(-18).join("\n");
	return /Auto-compacting\.\.\.|Queued message for after compaction|(?:^|\s)Working\.\.\.|Retrying(?:\s|…|\.\.\.)/m.test(
		tail,
	);
}

async function isBusy(client, panel) {
	if (panel.agent_status === "working") return true;
	if (!TERMINAL_STATUSES.has(panel.agent_status)) return false;
	return isBusyScreen(await terminalRead(client, panel.pane_id, "visible", 30));
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundText(text) {
	if (text.length <= MAX_TEXT_CHARS) return { text };
	return { text: `${text.slice(0, MAX_TEXT_CHARS)}\n…`, truncated: true };
}

function askOutput(ask) {
	if (!ask) return undefined;
	return {
		handoff: ask.handoff,
		prompts: ask.prompts.map((prompt) => ({
			title: prompt.title,
			multiple: prompt.multiple,
			choices: prompt.choices.map((choice) => choice.label),
			...(prompt.body ? { body: prompt.body } : {}),
		})),
	};
}

export function herdrHelp() {
	return {
		call: "await tools.herdr_agent(JSON.stringify(request))",
		actions: {
			find: {
				request: {
					action: "find",
					query: "string?",
					status: "idle | working | blocked | done?",
					include_self: "boolean?",
				},
				returns: "compact matching Pi panels",
			},
			send: {
				request: {
					action: "send",
					target: "string",
					text: "string",
					queue: "boolean? (default false)",
					wait: "boolean? (default true)",
					timeout_ms: "integer? (default 300000)",
				},
				returns: "new assistant text, blocked ask, timeout, or acknowledgement",
			},
			wait: {
				request: { action: "wait", target: "string", timeout_ms: "integer?" },
				returns: "settled latest assistant text or blocked ask",
			},
			read: {
				request: {
					action: "read",
					target: "string",
					source: "latest | visible | recent? (default latest)",
					lines: "1..200?",
				},
				returns: "latest assistant text or bounded terminal output",
			},
			answer: {
				request: {
					action: "answer",
					target: "string",
					answers: "Array<{ selections?: string[], other?: string, comment?: string }>",
					wait: "boolean? (default true)",
					timeout_ms: "integer?",
				},
				returns: "next assistant text, next ask, or completion",
			},
		},
		advanced: {
			load: 'await tools.more_skills("herdr")',
			covers: [
				"workspace/tab/pane lifecycle",
				"generic command panes",
				"raw terminal input",
				"output and agent-status waits",
			],
		},
	};
}

function stableKey(panel, view) {
	return [
		panel.agent_status,
		view.path,
		view.size,
		view.mtime_ms,
		view.leaf_id,
		view.assistant_entry?.id,
	].join(":");
}

async function waitForPanel(client, reader, paneId, baseline, timeoutMs, options = {}) {
	const deadline = Date.now() + timeoutMs;
	let latestPanel = await getAgent(client, paneId);
	let latestView = await reader.read(sessionPath(latestPanel));
	let candidate;
	let candidateSince = 0;
	while (Date.now() < deadline) {
		latestPanel = await getAgent(client, paneId);
		latestView = await reader.read(sessionPath(latestPanel));
		if (latestPanel.agent_status === "blocked") {
			const priorAskStillClearing =
				options.ignore_blocked_ask_id &&
				latestView.ask?.tool_call_id === options.ignore_blocked_ask_id;
			if (
				!(options.ignore_blocked_without_ask && !latestView.ask) &&
				!priorAskStillClearing
			)
				return {
					pane: paneId,
					status: "blocked",
					...(askOutput(latestView.ask)
						? { ask: askOutput(latestView.ask) }
						: {}),
				};
			await sleep(100);
			continue;
		}
		const terminal = TERMINAL_STATUSES.has(latestPanel.agent_status);
		const busy = terminal ? await isBusy(client, latestPanel) : false;
		const sessionChanged = baseline.path !== latestView.path;
		const assistantChanged =
			sessionChanged ||
			latestView.assistant_entry?.id !== baseline.assistant_entry_id;
		const branchAdvanced =
			sessionChanged || latestView.leaf_id !== baseline.leaf_id;
		const qualifies =
			!baseline.require_new ||
			assistantChanged ||
			(options.allow_branch_advance && branchAdvanced);
		if (terminal && !busy && qualifies) {
			const key = stableKey(latestPanel, latestView);
			if (candidate === key && Date.now() - candidateSince >= 500) {
				if (
					assistantChanged &&
					latestView.assistant_entry?.stop_reason === "error"
				)
					throw new Error(
						latestView.assistant?.text || `${paneId} assistant stopped with an error`,
					);
				const newReply =
					latestView.assistant?.id !== baseline.reply_id
						? latestView.assistant
						: undefined;
				return {
					pane: paneId,
					status: latestPanel.agent_status,
					...(newReply ? boundText(newReply.text) : { completed: true }),
					...(sessionChanged ? { session_changed: true } : {}),
				};
			}
			if (candidate !== key) {
				candidate = key;
				candidateSince = Date.now();
			}
		} else {
			candidate = undefined;
			candidateSince = 0;
		}
		await sleep(250);
	}
	return {
		pane: paneId,
		status: latestPanel.agent_status,
		timed_out: true,
	};
}

async function readKeybindings() {
	try {
		const value = JSON.parse(await readFile(join(AGENT_DIR, "keybindings.json"), "utf8"));
		return isObject(value) ? value : {};
	} catch {
		return {};
	}
}

function keyFor(bindings, action, fallback) {
	const configured = bindings[action];
	if (typeof configured === "string" && configured) return configured;
	if (Array.isArray(configured)) {
		const first = configured.find((key) => typeof key === "string" && key);
		if (first) return first;
		if (configured.length === 0)
			throw new Error(`${action} has no configured keybinding`);
	}
	return fallback;
}

export function resolveSendDisposition({ busy, queue }) {
	if (busy && queue)
		return { keybinding: "app.message.followUp", fallback: "alt+enter", mode: "follow_up" };
	return {
		keybinding: "tui.input.submit",
		fallback: "enter",
		mode: busy ? "steer" : "prompt",
	};
}

async function sendInput(client, paneId, input) {
	await client.request("pane.send_input", {
		pane_id: paneId,
		...(input.text !== undefined ? { text: input.text } : {}),
		...(input.keys ? { keys: input.keys } : {}),
	});
}

function normalizeDeliveryText(value) {
	return value.replace(/\s+/g, " ").trim();
}

export function detectDelivery(baseline, view, screen, text) {
	if (
		view.user?.id !== baseline.user?.id &&
		view.user?.text === text
	)
		return "delivered";
	const normalizedScreen = normalizeDeliveryText(screen);
	const prefix = normalizeDeliveryText(text).slice(0, 80);
	if (prefix && normalizedScreen.includes(`Follow-up: ${prefix}`))
		return "queued_follow_up";
	if (prefix && normalizedScreen.includes(`Steering: ${prefix}`))
		return "queued_steer";
	return undefined;
}

async function waitForDelivery(client, reader, paneId, baseline, text) {
	const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const panel = await getAgent(client, paneId);
		const [view, screen] = await Promise.all([
			reader.read(sessionPath(panel)),
			terminalRead(client, paneId, "visible", 50),
		]);
		const delivery = detectDelivery(baseline, view, screen, text);
		if (delivery) return delivery;
		await sleep(50);
	}
	return undefined;
}

function down(count, key) {
	return Array.from({ length: Math.max(0, count) }, () => key);
}

export function planAskAnswer(prompts, answers, controls = {}) {
	if (answers.length !== prompts.length)
		throw new Error(
			`answer requires ${prompts.length} response${prompts.length === 1 ? "" : "s"}, in prompt order`,
		);
	const keys = {
		down: controls.down || "down",
		confirm: controls.confirm || "enter",
		next: controls.next || "tab",
	};
	const steps = [];
	for (const [promptIndex, prompt] of prompts.entries()) {
		const answer = answers[promptIndex];
		const labels = answer.selections ?? [];
		const indexes = labels.map((label) => {
			const index = prompt.choices.findIndex((choice) => choice.label === label);
			if (index < 0)
				throw new Error(
					`unknown choice ${JSON.stringify(label)} for ${JSON.stringify(prompt.title)}`,
				);
			return index;
		});
		if (new Set(indexes).size !== indexes.length)
			throw new Error(`duplicate choice for ${JSON.stringify(prompt.title)}`);
		if (!prompt.multiple && indexes.length > 1)
			throw new Error(`${JSON.stringify(prompt.title)} accepts one choice`);
		if (!prompt.multiple && indexes.length && answer.other !== undefined)
			throw new Error(
				`${JSON.stringify(prompt.title)} cannot combine a choice with Other/rephrase`,
			);
		indexes.sort((a, b) => a - b);
		let focus = 0;
		for (const index of indexes) {
			steps.push({ keys: [...down(index - focus, keys.down), keys.confirm] });
			focus = index;
		}
		const needsOther =
			answer.other !== undefined ||
			(indexes.length === 0 && answer.comment !== undefined);
		if (needsOther) {
			steps.push({
				keys: [...down(prompt.choices.length - focus, keys.down), keys.confirm],
			});
			steps.push({ text: answer.other ?? "", keys: [keys.confirm] });
			focus = prompt.choices.length;
		}
		if (answer.comment !== undefined) {
			steps.push({
				keys: [
					...down(prompt.choices.length + 1 - focus, keys.down),
					keys.confirm,
				],
			});
			steps.push({ text: answer.comment, keys: [keys.next] });
		} else {
			steps.push({ keys: [keys.next] });
		}
	}
	steps.push({ keys: [keys.confirm], final: true });
	return steps;
}

function askFrame(screen) {
	const lines = screen.split("\n");
	const review = lines.map((line) => line.includes("Review")).lastIndexOf(true);
	return (review >= 0 ? lines.slice(review) : lines.slice(-30)).join("\n");
}

export function inspectAskScreen(screen, ask) {
	const frame = askFrame(screen);
	const selected = frame.match(/^>\s+(.*?)\s*$/m)?.[1];
	const review = /^\s*Review\s*$/m.test(frame) && frame.includes("enter submit");
	const current_prompt = review
		? "Review"
		: ask?.prompts.find((prompt) =>
				frame.split("\n").some((line) => line.trim() === prompt.title),
			)?.title;
	const prompt =
		frame.includes("Review") &&
		frame.includes("Other/rephrase") &&
		frame.includes("Comment (optional)");
	return { recognized: prompt || review, current_prompt, selected };
}

async function answerAsk(client, reader, panel, request) {
	if (panel.agent_status !== "blocked")
		throw new Error(
			`${panel.pane_id} is ${panel.agent_status}, not blocked on ask`,
		);
	const baseline = await reader.read(sessionPath(panel));
	if (!baseline.ask)
		throw new Error(`${panel.pane_id} has no pending pi-ask call on its active branch`);
	const screen = await terminalRead(client, panel.pane_id, "visible", 80);
	const inspection = inspectAskScreen(screen, baseline.ask);
	const first = baseline.ask.prompts[0];
	const expectedSelection = first?.choices[0]?.label ?? "Other/rephrase";
	if (
		!inspection.recognized ||
		inspection.current_prompt !== first?.title ||
		inspection.selected !== expectedSelection
	)
		throw new Error(
			"ask UI is not at the first prompt's default selection; refusing to send guessed keys",
		);
	const bindings = await readKeybindings();
	const steps = planAskAnswer(baseline.ask.prompts, request.answers, {
		down: keyFor(bindings, "tui.select.down", "down"),
		confirm: keyFor(bindings, "tui.select.confirm", "enter"),
		next: keyFor(bindings, "tui.input.tab", "tab"),
	});
	for (const step of steps) {
		await sendInput(client, panel.pane_id, step);
		await sleep(35);
		if (!step.final) {
			const current = await getAgent(client, panel.pane_id);
			if (current.agent_status !== "blocked")
				throw new Error("ask closed before all requested answers were entered");
			const currentScreen = await terminalRead(
				client,
				panel.pane_id,
				"visible",
				80,
			);
			if (!inspectAskScreen(currentScreen, baseline.ask).recognized)
				throw new Error("ask UI became unrecognized; stopped without retrying input");
		}
	}
	if (!request.wait)
		return { pane: panel.pane_id, answered: true };
	return waitForPanel(
		client,
		reader,
		panel.pane_id,
		{
			path: baseline.path,
			leaf_id: baseline.leaf_id,
			assistant_entry_id: baseline.assistant_entry?.id,
			reply_id: baseline.assistant?.id,
			require_new: true,
		},
		request.timeout_ms,
		{
			allow_branch_advance: true,
			ignore_blocked_without_ask: true,
			ignore_blocked_ask_id: baseline.ask.tool_call_id,
		},
	);
}

async function execute(request) {
	if (request.action === "help") return herdrHelp();
	const client = new HerdrClient();
	const reader = new SessionReader();
	if (request.action === "find") {
		const panels = await findPanels(client, request);
		return { panels: panels.slice(0, 30).map(compactPanel) };
	}
	const panel = await resolvePanel(client, request.target);
	if (request.action === "read") {
		if (request.source !== "latest") {
			const output = boundText(
				await terminalRead(client, panel.pane_id, request.source, request.lines),
			);
			return { pane: panel.pane_id, status: panel.agent_status, ...output };
		}
		const view = await reader.read(sessionPath(panel));
		return {
			pane: panel.pane_id,
			status: panel.agent_status,
			...(view.assistant ? boundText(view.assistant.text) : { text: null }),
			...(panel.agent_status === "blocked" && askOutput(view.ask)
				? { ask: askOutput(view.ask) }
				: {}),
		};
	}
	assertRemote(panel);
	if (request.action === "wait") {
		const view = await reader.read(sessionPath(panel));
		return waitForPanel(
			client,
			reader,
			panel.pane_id,
			{
				path: view.path,
				leaf_id: view.leaf_id,
				assistant_entry_id: view.assistant_entry?.id,
				reply_id: undefined,
				require_new: false,
			},
			request.timeout_ms,
		);
	}
	if (request.action === "answer")
		return answerAsk(client, reader, panel, request);

	const baseline = await reader.read(sessionPath(panel));
	if (panel.agent_status === "blocked")
		throw new Error(
			`${panel.pane_id} is blocked${baseline.ask ? " on ask; use action=answer" : ""}`,
		);
	const busy = await isBusy(client, panel);
	const disposition = resolveSendDisposition({ busy, queue: request.queue });
	const bindings = await readKeybindings();
	const key = keyFor(
		bindings,
		disposition.keybinding,
		disposition.fallback,
	);
	// Paste and submit separately. A combined PTY write can hit Pi's
	// streaming-to-idle transition before the editor has consumed the paste.
	await sendInput(client, panel.pane_id, { text: request.text });
	await sleep(40);
	await sendInput(client, panel.pane_id, { keys: [key] });
	let delivery = await waitForDelivery(
		client,
		reader,
		panel.pane_id,
		baseline,
		request.text,
	);
	if (!delivery) {
		// Retrying only the submit key is duplicate-safe: if Pi accepted the first
		// key, its editor is empty; if it missed the key, the pasted text remains.
		const current = await getAgent(client, panel.pane_id);
		const retryDisposition = resolveSendDisposition({
			busy: await isBusy(client, current),
			queue: request.queue,
		});
		const retryKey = keyFor(
			bindings,
			retryDisposition.keybinding,
			retryDisposition.fallback,
		);
		await sendInput(client, panel.pane_id, { keys: [retryKey] });
		delivery = await waitForDelivery(
			client,
			reader,
			panel.pane_id,
			baseline,
			request.text,
		);
	}
	if (!delivery)
		throw new Error(
			`${panel.pane_id} did not accept the message; the text may remain in Pi's editor`,
		);
	if (!request.wait)
		return { pane: panel.pane_id, sent: true, mode: disposition.mode, delivery };
	return waitForPanel(
		client,
		reader,
		panel.pane_id,
		{
			path: baseline.path,
			leaf_id: baseline.leaf_id,
			assistant_entry_id: baseline.assistant_entry?.id,
			reply_id: baseline.assistant?.id,
			require_new: true,
		},
		request.timeout_ms,
	);
}

async function readStdin() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	return input;
}

async function main() {
	const result = await execute(parseRequest(await readStdin()));
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname)
	main().catch((error) => {
		process.stderr.write(
			`herdr_agent: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
