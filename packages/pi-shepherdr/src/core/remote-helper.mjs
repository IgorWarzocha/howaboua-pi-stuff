import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());
const child = spawn(
	"hc",
	["connect", "--session", input.session || "default"],
	{ stdio: ["pipe", "pipe", "pipe"] },
);
const pending = new Map();
let id = 0;
let diagnostic = "";
child.stderr.on("data", (chunk) => {
	diagnostic = (diagnostic + chunk).slice(-4096);
});
function failed(error) {
	for (const entry of pending.values()) entry.reject(error);
	pending.clear();
}
child.on("error", failed);
child.stdin.on("error", failed);
child.on("exit", () =>
	failed(new Error(diagnostic || "Remote Core connection closed")),
);
createInterface({ input: child.stdout }).on("line", (line) => {
	try {
		const reply = JSON.parse(line);
		const entry = pending.get(reply.id);
		if (!entry) return;
		pending.delete(reply.id);
		if (reply.error) entry.reject(new Error(reply.error.message));
		else entry.resolve(reply.result);
	} catch (error) {
		failed(error);
	}
});
function rpc(method, params = {}) {
	return new Promise((resolve, reject) => {
		pending.set(++id, { resolve, reject });
		child.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
		);
	});
}
function rejected(message) {
	return Object.assign(new Error(message), {
		code: "SHEPHERDR_DELIVERY_REJECTED",
	});
}
async function nativeRequest(method, params) {
	const terminal = params.target ?? params.pane_id ?? params.caller_pane_id;
	if (typeof terminal !== "string" || !/^t[0-9a-z]+$/.test(terminal))
		throw rejected("Use the exact remote terminal address");
	const record = await rpc("terminal.get", { terminal });
	if (record.address !== terminal)
		throw rejected("Remote terminal changed; resolve it again");
	if (method === "pane.close") {
		if (record.state === "live") await rpc("terminal.kill", { terminal });
		return rpc("terminal.rm", { terminal });
	}
	const path = record.labels["pi.session_file"];
	const agent = {
		pane_id: terminal,
		terminal_id: terminal,
		agent: path ? "pi" : null,
		...(path ? { agent_session: { kind: "path", value: path } } : {}),
	};
	if (method === "agent.get") return { agent };
	if (method === "pane.current") return { pane: agent };
	throw rejected("Remote peer action is unavailable");
}
async function run() {
	const hello = await rpc("hello");
	if (hello.core.id !== input.coreId)
		throw rejected(
			"Remote Core identity changed; refresh machines before retrying",
		);
	const peer = await import(input.modules.peer);
	switch (input.op) {
		case "list": {
			const result = await rpc("terminal.list");
			return {
				terminals: result.terminals.filter(
					(terminal) => !terminal.address.includes("/"),
				),
			};
		}
		case "identity":
			return { host: hostname(), session: hello.core.id };
		case "message":
			return peer.sendPeerMessage(nativeRequest, input.agent, input.message);
		case "commands":
			return peer.sendPeerCommands(nativeRequest, input.agent);
		case "reply":
			return peer.sendPeerExtensionReply(
				nativeRequest,
				input.agent,
				input.reply,
			);
		case "context":
			return (await import(input.modules.context)).requestContext(
				input.path,
				input.request,
			);
		case "view":
			return (await import(input.modules.session)).readSessionView(input.path);
		case "directory": {
			const expand = (value) =>
				value === "~"
					? homedir()
					: value.startsWith("~/")
						? resolve(homedir(), value.slice(2))
						: value;
			const path = resolve(
				expand(input.fallback),
				expand(input.value?.trim() || "."),
			);
			if (!(await stat(path)).isDirectory())
				throw new Error("Remote working directory is not a directory");
			return path;
		}
		case "watch": {
			const watcher = await import(input.modules.watch);
			return new Promise((resolve, reject) => {
				let close = () => {};
				const timer = setTimeout(() => {
					close();
					resolve([]);
				}, 10_000);
				try {
					close = watcher.watchSessions(
						input.paths,
						(path) => {
							clearTimeout(timer);
							close();
							resolve([path]);
						},
						(error) => {
							clearTimeout(timer);
							close();
							reject(error);
						},
					);
				} catch (error) {
					clearTimeout(timer);
					reject(error);
				}
			});
		}
		default:
			throw rejected("Unknown remote operation");
	}
}
try {
	process.stdout.write(
		JSON.stringify({ ok: true, result: await run() }) + "\n",
	);
} catch (error) {
	process.stdout.write(
		JSON.stringify({ ok: false, error: error.message, code: error.code }) +
			"\n",
	);
} finally {
	child.stdin.end();
	child.kill();
}
