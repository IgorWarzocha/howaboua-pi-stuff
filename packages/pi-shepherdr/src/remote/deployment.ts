import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SshMachine } from "../machine-catalog.js";

export const BRIDGE_VERSION = 22;
const REMOTE_HELPER = "~/.pi/agent/shepherdr.mjs";
const REMOTE_PEER_HELPER = "~/.pi/agent/shepherdr-peer.mjs";
const REMOTE_CHANNEL_HELPER = "~/.pi/agent/shepherdr-channel.mjs";
const REMOTE_SESSION_HELPER = "~/.pi/agent/shepherdr-session.mjs";
const REMOTE_SESSION_WATCH_HELPER = "~/.pi/agent/shepherdr-session-watch.mjs";
const REMOTE_CHECKPOINT_HELPER = "~/.pi/agent/shepherdr-checkpoints.mjs";
const REMOTE_CONTEXT_HELPER = "~/.pi/agent/shepherdr-context.mjs";
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DEPLOY_TIMEOUT_MS = 20_000;

const DEPLOY_SOURCE = String.raw`
const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, unlink, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");
const targetValue = process.argv[1];
const marker = "// @howaboua/pi-shepherdr managed bridge";
const target = targetValue === "~" ? homedir() : targetValue.startsWith("~/") ? join(homedir(), targetValue.slice(2)) : targetValue;
const chunks = [];
let size = 0;
process.stdin.on("data", chunk => { size += chunk.length; if (size > 1024 * 1024) { process.stderr.write("bridge source is too large\n"); process.exit(1); } chunks.push(chunk); });
process.stdin.on("end", () => { void (async () => {
  const source = Buffer.concat(chunks);
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) {
    if (existing.equals(source)) { process.stdout.write(JSON.stringify({ updated: false, path: target }) + "\n"); return; }
    if (!existing.toString("utf8", 0, marker.length + 32).startsWith(marker)) throw new Error(target + " is not owned by Shepherdr");
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  process.stdout.write(JSON.stringify({ updated: true, path: target }) + "\n");
})().catch(error => { process.stderr.write(error.message + "\n"); process.exit(1); }); });
`;

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function executablePath(path: string): string {
	return path.startsWith("~/")
		? `"$HOME"/${shellQuote(path.slice(2))}`
		: shellQuote(path);
}

function remoteCommand(config: SshMachine): string {
	const args = [
		"exec",
		"node",
		executablePath(REMOTE_HELPER),
		"--session",
		shellQuote(config.session),
	];
	return args.join(" ");
}

function spawnConnector(
	config: SshMachine,
	command: string,
): ChildProcessWithoutNullStreams {
	return spawn(
		"ssh",
		["-T", "-o", "BatchMode=yes", "--", config.target, command],
		{
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
}

export function appendBounded(current: string, chunk: Buffer): string {
	const next = current + chunk.toString("utf8");
	return next.length <= MAX_DIAGNOSTIC_BYTES
		? next
		: next.slice(next.length - MAX_DIAGNOSTIC_BYTES);
}

async function deploy(
	config: SshMachine,
	source: Buffer,
	target: string,
): Promise<void> {
	const command = [
		"node",
		"-e",
		shellQuote(DEPLOY_SOURCE),
		shellQuote(target),
	].join(" ");
	const child = spawnConnector(config, command);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = appendBounded(stdout, chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = appendBounded(stderr, chunk);
	});
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("remote bridge deployment timed out"));
		}, DEPLOY_TIMEOUT_MS);
		timer.unref();
		child.stdin.on("error", (error) => {
			clearTimeout(timer);
			child.kill();
			reject(error);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else
				reject(
					new Error(
						stderr.trim() ||
							stdout.trim() ||
							`remote bridge deployment exited ${code ?? "without status"}`,
					),
				);
		});
		child.stdin.end(source);
	});
}

export async function connectRemoteBridge(
	config: SshMachine,
): Promise<ChildProcessWithoutNullStreams> {
	const [
		source,
		peerSource,
		channelSource,
		sessionSource,
		contextSource,
		checkpointSource,
		sessionWatchSource,
	] = await Promise.all([
		readFile(fileURLToPath(new URL("./shepherdr.mjs", import.meta.url))),
		readFile(fileURLToPath(new URL("./shepherdr-peer.mjs", import.meta.url))),
		readFile(
			fileURLToPath(new URL("./shepherdr-channel.mjs", import.meta.url)),
		),
		readFile(
			fileURLToPath(new URL("./shepherdr-session.mjs", import.meta.url)),
		),
		readFile(
			fileURLToPath(new URL("./shepherdr-context.mjs", import.meta.url)),
		),
		readFile(
			fileURLToPath(new URL("./shepherdr-checkpoints.mjs", import.meta.url)),
		),
		readFile(
			fileURLToPath(new URL("./shepherdr-session-watch.mjs", import.meta.url)),
		),
	]);
	await deploy(config, peerSource, REMOTE_PEER_HELPER);
	await deploy(config, channelSource, REMOTE_CHANNEL_HELPER);
	await deploy(config, sessionSource, REMOTE_SESSION_HELPER);
	await deploy(config, sessionWatchSource, REMOTE_SESSION_WATCH_HELPER);
	await deploy(config, checkpointSource, REMOTE_CHECKPOINT_HELPER);
	await deploy(config, contextSource, REMOTE_CONTEXT_HELPER);
	await deploy(config, source, REMOTE_HELPER);
	return spawnConnector(config, remoteCommand(config));
}
