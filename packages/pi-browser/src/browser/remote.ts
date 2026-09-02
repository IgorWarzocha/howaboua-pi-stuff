import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { artifactDirectory } from "./artifacts.js";
import type { BrowserOperation } from "./operation.js";
import { ensureRemoteHelper, remoteNodeCommand } from "./remote-helper.js";
import { runProgram } from "./remote-process.js";
import type { BrowserRoute } from "./routes.js";

const SAFE_REMOTE_FILE = /^\/[A-Za-z0-9_./-]+$/;

export { remoteNodeCommand } from "./remote-helper.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function copyRemoteArtifact(
	host: string,
	remoteFile: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!SAFE_REMOTE_FILE.test(remoteFile)) {
		throw new Error(
			`remote browser returned an unsafe artifact path: ${remoteFile}`,
		);
	}
	await mkdir(artifactDirectory(), { recursive: true, mode: 0o700 });
	const localFile = join(
		artifactDirectory(),
		`${host}-${basename(remoteFile)}`,
	);
	const copied = await runProgram(
		"scp",
		["-q", `${host}:${remoteFile}`, localFile],
		undefined,
		signal,
	);
	if (copied.code !== 0) {
		throw new Error(
			copied.stderr || copied.stdout || "could not copy remote screenshot",
		);
	}
	try {
		const removed = await runProgram(
			"ssh",
			[host, `/usr/bin/rm -- ${remoteFile}`],
			undefined,
			signal,
		);
		if (removed.code !== 0) {
			throw new Error(
				removed.stderr ||
					removed.stdout ||
					"copied screenshot but could not remove remote artifact",
			);
		}
		return localFile;
	} catch (error) {
		await rm(localFile, { force: true });
		throw error;
	}
}

async function localizeScreenshots(
	host: string,
	operations: BrowserOperation[],
	result: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<void> {
	for (const [index, operation] of operations.entries()) {
		if (operation.action !== "screenshot") continue;
		const item =
			operations.length === 1
				? result
				: Array.isArray(result["results"])
					? result["results"][index]
					: undefined;
		if (!isRecord(item) || typeof item["file"] !== "string") {
			throw new Error(`remote screenshot result ${index} has no file path`);
		}
		item["file"] = await copyRemoteArtifact(host, item["file"], signal);
	}
}

export async function executeRemoteBrowser(
	route: BrowserRoute,
	operations: BrowserOperation[],
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (!route.remote) {
		throw new Error(`Browser host ${route.name} has no remote command`);
	}
	await ensureRemoteHelper(route.name, route.remote, signal);
	const executed = await runProgram(
		"ssh",
		[route.name, remoteNodeCommand(route.remote)],
		JSON.stringify({ operations }),
		signal,
	);
	if (executed.code !== 0) {
		throw new Error(
			executed.stderr ||
				executed.stdout ||
				`remote browser exited with code ${executed.code}`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(executed.stdout);
	} catch (error) {
		throw new Error(
			`remote browser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) {
		throw new Error("remote browser result is not an object");
	}
	await localizeScreenshots(route.name, operations, value, signal);
	return value;
}
