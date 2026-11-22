// Real Core and inert PTYs. No coding agent, model, account or live session.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { watch } from "node:fs";
import { Core } from "../src/core.mjs";
import { stateChangePath, workspaceDatabasePath } from "../src/storage.mjs";
import { openWorkspaceDatabase } from "../src/database.mjs";

const execute = promisify(execFile);
const root = await mkdtemp("/var/tmp/herdr-proactive-");
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("HC_")),
);
Object.assign(env, {
	HC_SESSION: "proactive-smoke",
	HC_SOCKET: join(root, "core.sock"),
	XDG_STATE_HOME: join(root, "state"),
	XDG_CONFIG_HOME: join(root, "config"),
	XDG_RUNTIME_DIR: root,
	HERDR_APP_HOME: join(root, "app"),
	SHELL: "/bin/sh",
});
const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const run = (action, data) =>
	execute(
		process.execPath,
		[cli, action, ...(data === undefined ? [] : [JSON.stringify(data)])],
		{ env, timeout: 30000 },
	).then((reply) => JSON.parse(reply.stdout));
let core, subscription, service;

// Wait on events, with one initial read. A timeout fails the smoke, never polls.
function waitFor(
	read,
	predicate,
	filter,
	description = String(predicate),
	path = null,
) {
	return new Promise((resolve, reject) => {
		let reading = false,
			dirty = false,
			done = false,
			last;
		const timer = setTimeout(
			() =>
				finish(
					new Error(
						"Timed out: " + description + "\nLast: " + JSON.stringify(last),
					),
				),
			15000,
		);
		const finish = (error, value) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			subscription.off("notification", event);
			watcher?.close();
			if (error) reject(error);
			else resolve(value);
		};
		const check = async () => {
			dirty = true;
			if (reading) return;
			reading = true;
			try {
				while (dirty && !done) {
					dirty = false;
					const value = await read();
					last = value;
					if (predicate(value)) finish(null, value);
				}
			} catch (error) {
				finish(error);
			}
			reading = false;
		};
		const event = (message) => {
			if (message.method === "event" && filter(message.params)) void check();
		};
		const watcher = path
			? watch(dirname(path), (_kind, name) => {
					if (!name || name.toString() === basename(path)) void check();
				})
			: null;
		subscription.on("notification", event);
		void check();
	});
}
const waitAgent = (address, check) =>
	waitFor(
		() => core.call("terminal.get", { terminal: address }),
		check,
		(e) => e.terminal === address,
	);

async function startService() {
	const child = spawn(process.execPath, [cli, "serve"], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	service = child;
	let output = "",
		errors = "";
	child.stderr.on("data", (bytes) => {
		errors += bytes;
	});
	await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Service startup timeout: " + errors + output)),
			15000,
		);
		const ended = (code) => {
			clearTimeout(timer);
			reject(new Error("Service exited: " + code + " " + output + errors));
		};
		child.once("exit", ended);
		child.stdout.on("data", (bytes) => {
			output += bytes;
			if (output.includes('"running":true')) {
				clearTimeout(timer);
				child.off("exit", ended);
				resolve();
			}
		});
	});
	return child;
}

async function stopService(signal = "SIGTERM") {
	if (!service || service.exitCode !== null || service.signalCode) return;
	const ended = once(service, "exit");
	service.kill(signal);
	await ended;
}

try {
	await mkdir(join(root, "config/herdr-core"), { recursive: true });
	await writeFile(
		join(root, "config/herdr-core/config.toml"),
		'notes = false\nshell = ["/bin/sh"]\n',
	);
	await execute("hc", ["server", "start"], { env, timeout: 15000 });
	core = new Core(env);
	const info = await core.call("server.status");
	const databasePath = workspaceDatabasePath(info.core.id, root, env);
	const changed = stateChangePath(info.core.id, root, env);
	subscription = new Core(env);
	await subscription.call("events.subscribe");
	const fixture = join(root, "fixture.mjs");
	const log = join(root, "prompts");
	await writeFile(log, "");
	const deliveries = async () =>
		(await readFile(log, "utf8")).split("\n").filter(Boolean).length;
	await writeFile(
		fixture,
		[
			'import { appendFileSync } from "node:fs";',
			"process.stdin.setRawMode(true); process.stdin.resume();",
			'const status=s=>process.stdout.write("\\x1b]7501;state="+s+":app=fixture\\x1b\\\\");',
			'process.stdout.write("\\x1b[?2004h"); status("idle"); let input="", received=0;',
			'process.stdin.on("data",chunk=>{ for(const c of chunk.toString()){',
			'if(c==="\\x02"){status("working");continue;} if(c==="\\x09"){status("idle");continue;}',
			'if(c!=="\\r"){input+=c;continue;}',
			"appendFileSync(" +
				JSON.stringify(log) +
				',JSON.stringify(input)+"\\n"); input="";',
			// The second send reaches the PTY but never reports a new turn.
			'if(++received===1){status("working");setTimeout(()=>status("idle"),200);}',
			"}});",
		].join("\n"),
	);
	const made = await core.call("terminal.run", {
		argv: [process.execPath, fixture],
		cwd: root,
		no_parent: true,
		labels: { "herdr.space": "workspace" },
	});
	const address = made.address;
	await waitAgent(address, (t) => t.status?.state === "idle");
	const configured = await run("configure", {
		name: "Smoke",
		scope: "workspace",
		space: "workspace",
		terminal: address,
		enabled: true,
		allowTerminalInput: true,
		mode: "off",
		prompt: "A harmless fixture prompt",
		jobs: [],
	});
	const id = configured.configured;
	const readPolicy = () => {
		const db = openWorkspaceDatabase(databasePath, { readOnly: true });
		try {
			return db.readRuntime().policies[id];
		} finally {
			db.close();
		}
	};
	const waitPolicy = (check) =>
		waitFor(readPolicy, check, () => false, String(check), changed);
	await startService();
	// Busy work is deferred until idle, then the event releases exactly one manual request.
	await core.call("terminal.keys", { terminal: address, keys: ["ctrl+b"] });
	await waitAgent(address, (t) => t.status?.state === "working");
	await run("run", { id });
	await waitPolicy(
		(policy) =>
			policy?.reason?.includes("working") && policy.receipts.length === 0,
	);
	assert.equal(await deliveries(), 0);
	await core.call("terminal.keys", { terminal: address, keys: ["tab"] });
	await waitPolicy((policy) =>
		policy?.receipts.some((r) => r.outcome === "started"),
	);
	assert.equal(await deliveries(), 1);
	await waitAgent(address, (t) => t.status?.state === "idle");

	// Crash after the prompt reached the PTY but before Core confirmed a new turn.
	await run("run", { id });
	await waitFor(
		deliveries,
		(count) => count >= 2,
		() => false,
		"second send",
		log,
	);
	const attempt = readPolicy().inflight;
	assert.equal(attempt?.kind, "manual");
	await stopService("SIGKILL");
	await startService();
	await waitPolicy((policy) => policy?.awaitingAck === true);
	await run("acknowledge", { id });
	const acknowledged = await waitPolicy(
		(policy) => policy?.awaitingAck === false && policy.reason === "off",
	);
	assert.equal(acknowledged.manualRequest, attempt.job);
	assert.equal(acknowledged.inflight, null);
	assert.deepEqual(
		acknowledged.receipts.map(({ outcome }) => outcome),
		["started", "uncertain"],
	);
	assert.equal(await deliveries(), 2);
	await stopService();

	// Removing a policy owns its Markdown definitions, not neighboring user files.
	const pulseHome = join(root, "pulses/agent-authored");
	await mkdir(pulseHome, { recursive: true });
	const pulse = [
		"---",
		"title: Agent-authored automation",
		"policy: " + basename(dirname(configured.path)),
		"enabled: false",
		"schedule: every 1h",
		"timezone: UTC",
		"---",
		"Inspect only the fixture.",
		"",
	].join("\n");
	await writeFile(join(pulseHome, "PULSE.md"), pulse);
	const journal = join(pulseHome, "journal.md");
	await writeFile(journal, "Keep this artifact.");
	await run("remove", { id });
	await assert.rejects(readFile(configured.path), { code: "ENOENT" });
	await assert.rejects(readFile(join(pulseHome, "PULSE.md")), {
		code: "ENOENT",
	});
	assert.equal(await readFile(journal, "utf8"), "Keep this artifact.");
	console.log(
		"PASS: Core busy deferral, no replay after interrupted send, artifact-safe removal",
	);
} finally {
	await stopService();
	subscription?.close();
	core?.close();
	await execute("hc", ["server", "stop"], { env, timeout: 10000 }).catch(
		(error) => console.error("Scratch shutdown: " + error.message),
	);
	await rm(root, { recursive: true, force: true });
}
