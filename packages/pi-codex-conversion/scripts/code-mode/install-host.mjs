#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { EnvHttpProxyAgent, fetch } from "undici";

import { HOST_ASSETS, hostAssetUrl } from "./host-assets.mjs";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const INSTALL_LOCK_POLL_MS = 200;
const INSTALL_LOCK_TIMEOUT_MS = 125_000;
const INSTALL_LOCK_STALE_MS = 180_000;
const shutdownController = new AbortController();
const cancelInstall = () => shutdownController.abort(new Error("code-mode host install cancelled"));
process.once("SIGINT", cancelInstall);
process.once("SIGTERM", cancelInstall);
const platform = `${process.platform}-${process.arch}`;
const asset = HOST_ASSETS[platform];
if (!asset) {
	console.error(`[pi-codex-conversion] Unsupported code-mode platform: ${platform}`);
	process.exit(1);
}
const [assetName, expectedSha256] = asset;
const binaryName =
	process.platform === "win32"
		? "codex-code-mode-host.exe"
		: "codex-code-mode-host";
const destination = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!destination || basename(destination) !== binaryName) {
	console.error(`[pi-codex-conversion] Usage: install-host.mjs /absolute/path/${binaryName}`);
	process.exit(1);
}
const outDir = resolve(destination, "..");
if (existsSync(destination)) process.exit(0);
mkdirSync(outDir, { recursive: true });
const lockPath = `${destination}.lock`;
if (!(await acquireInstallLock(lockPath, destination, shutdownController.signal))) process.exit(0);

const temporary = mkdtempSync(join(tmpdir(), "pi-codex-code-mode-"));
try {
	const assetUrl = hostAssetUrl(assetName);
	const dispatcher = new EnvHttpProxyAgent();
	let bytes;
	try {
		const response = await fetch(assetUrl, {
			dispatcher,
			redirect: "follow",
			signal: AbortSignal.any([shutdownController.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
		});
		if (!response.ok)
			throw new Error(
				`download failed: ${response.status} ${response.statusText}`,
			);
		bytes = Buffer.from(await response.arrayBuffer());
	} catch (error) {
		throw new Error(
			`failed to download ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	} finally {
		await dispatcher.close();
	}
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expectedSha256)
		throw new Error(`checksum mismatch for ${assetName}`);
	const staged = `${destination}.${process.pid}.tmp`;
	if (process.platform === "win32") {
		writeFileSync(staged, bytes);
	} else {
		const archive = join(temporary, basename(assetName));
		writeFileSync(archive, bytes);
		const extracted = join(temporary, "extracted");
		mkdirSync(extracted);
		const result = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
			stdio: "inherit",
		});
		shutdownController.signal.throwIfAborted();
		if (result.status !== 0)
			throw new Error("failed to extract code-mode host archive");
		const candidates = walk(extracted).filter((path) =>
			basename(path).startsWith("codex-code-mode-host"),
		);
		if (candidates.length !== 1)
			throw new Error(
				`expected one code-mode host binary, found ${candidates.length}`,
			);
		copyFileSync(candidates[0], staged);
		chmodSync(staged, 0o755);
	}
	renameSync(staged, destination);
	console.log(`[pi-codex-conversion] Installed ${destination}`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
	rmSync(lockPath, { recursive: true, force: true });
	process.off("SIGINT", cancelInstall);
	process.off("SIGTERM", cancelInstall);
}

async function acquireInstallLock(lockPath, destination, signal) {
	const deadline = Date.now() + INSTALL_LOCK_TIMEOUT_MS;
	while (Date.now() < deadline) {
		signal.throwIfAborted();
		if (existsSync(destination)) return false;
		try {
			mkdirSync(lockPath);
			return true;
		} catch (error) {
			if (!error || typeof error !== "object" || error.code !== "EEXIST")
				throw error;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > INSTALL_LOCK_STALE_MS) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
			} catch (statError) {
				if (!statError || typeof statError !== "object" || statError.code !== "ENOENT")
					throw statError;
			}
			await delay(INSTALL_LOCK_POLL_MS, undefined, { signal });
		}
	}
	if (existsSync(destination)) return false;
	throw new Error(`timed out waiting for code-mode host install lock: ${lockPath}`);
}

function walk(dir) {
	const paths = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) paths.push(...walk(path));
		else paths.push(path);
	}
	return paths;
}
