import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { abortReason, runProgram } from "./remote-process.js";
import type { BrowserRemoteCommand } from "./routes.js";

const DEPLOY_TIMEOUT_MS = 20_000;
const REMOTE_HELPER = "~/.pi/agent/pi-browser-worker.mjs";
const deployments = new Map<string, Promise<void>>();
let helperSourcePromise: Promise<string> | undefined;

const DEPLOY_SOURCE = String.raw`
const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, unlink, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");
const targetValue = process.argv[1];
const marker = "// @howaboua/pi-browser managed worker";
const target = targetValue === "~" ? homedir() : targetValue.startsWith("~/") ? join(homedir(), targetValue.slice(2)) : targetValue;
const chunks = [];
let size = 0;
process.stdin.on("data", chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { process.stderr.write("worker source is too large\n"); process.exit(1); } chunks.push(chunk); });
process.stdin.on("end", () => { void (async () => {
  const source = Buffer.concat(chunks);
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) {
    if (existing.equals(source)) { process.stdout.write(JSON.stringify({ updated: false, path: target }) + "\n"); return; }
    if (!existing.toString("utf8", 0, 512).includes(marker)) throw new Error(target + " is not owned by pi-browser");
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

export function remoteNodeCommand(command: BrowserRemoteCommand): string {
	return `${command.nodePath} --preserve-symlinks-main "$HOME"/.pi/agent/pi-browser-worker.mjs`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolveValue, reject) => {
		const abort = () => {
			cleanup();
			reject(abortReason(signal));
		};
		const cleanup = () => signal.removeEventListener("abort", abort);
		signal.addEventListener("abort", abort, { once: true });
		promise.then(
			(value) => {
				cleanup();
				resolveValue(value);
			},
			(error) => {
				cleanup();
				reject(error);
			},
		);
	});
}

async function readHelperSource(): Promise<string> {
	const candidates = [
		fileURLToPath(new URL("../../remote-worker.js", import.meta.url)),
		fileURLToPath(new URL("../../dist/remote-worker.js", import.meta.url)),
	];
	let lastError: unknown;
	for (const path of candidates) {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(
		`Could not read bundled browser worker: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
}

async function deployRemoteHelper(
	host: string,
	command: BrowserRemoteCommand,
): Promise<void> {
	helperSourcePromise ??= readHelperSource();
	const source = await helperSourcePromise;
	const deployment = await runProgram(
		"ssh",
		[
			host,
			`${command.nodePath} -e ${shellQuote(DEPLOY_SOURCE)} ${shellQuote(REMOTE_HELPER)}`,
		],
		source,
		AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
	);
	if (deployment.code !== 0) {
		throw new Error(
			deployment.stderr ||
				deployment.stdout ||
				"could not deploy remote browser worker",
		);
	}
}

export async function ensureRemoteHelper(
	host: string,
	command: BrowserRemoteCommand,
	signal?: AbortSignal,
): Promise<void> {
	const key = `${host}\0${command.nodePath}`;
	let deployment = deployments.get(key);
	if (!deployment) {
		deployment = deployRemoteHelper(host, command);
		deployments.set(key, deployment);
		void deployment.catch(() => {
			if (deployments.get(key) === deployment) deployments.delete(key);
		});
	}
	await waitFor(deployment, signal);
}
