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
import { codeModeHostBinaryName, hostAssetUrl, resolveCodeModeHostAsset } from "./host-assets.ts";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const INSTALL_LOCK_POLL_MS = 200;
const INSTALL_LOCK_TIMEOUT_MS = 125_000;
const INSTALL_LOCK_STALE_MS = 180_000;
const dynamicImport = (specifier: string) => import(specifier);

export interface InstallCodeModeHostOptions {
	destination: string;
	platform: string;
	arch: string;
	signal?: AbortSignal | undefined;
}

export async function installCodeModeHost(options: InstallCodeModeHostOptions): Promise<void> {
	const { destination: destinationInput, platform, arch, signal } = options;
	const [assetName, expectedSha256] = resolveCodeModeHostAsset(platform, arch);
	const binaryName = codeModeHostBinaryName(platform);
	const destination = resolve(destinationInput);
	if (basename(destination) !== binaryName) {
		throw new Error(`Code-mode host destination must end with ${binaryName}`);
	}
	if (existsSync(destination)) return;
	mkdirSync(resolve(destination, ".."), { recursive: true });
	const lockPath = `${destination}.lock`;
	if (!(await acquireInstallLock(lockPath, destination, signal))) return;

	const temporary = mkdtempSync(join(tmpdir(), "pi-codex-code-mode-"));
	const staged = `${destination}.${process.pid}.tmp`;
	try {
		const assetUrl = hostAssetUrl(assetName);
		let bytes: Buffer;
		try {
			const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
			const { getProxyForUrl } = await dynamicImport("proxy-from-env") as { getProxyForUrl(url: string): string };
			const proxy = getProxyForUrl(assetUrl);
			const response = await globalThis.fetch(assetUrl, {
				redirect: "follow",
				signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
				...(proxy ? { proxy } : {}),
			} as RequestInit & { proxy?: string });
			if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
			bytes = Buffer.from(await response.arrayBuffer());
		} catch (error) {
			throw new Error(`failed to download ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
			throw new Error(`checksum mismatch for ${assetName}`);
		}
		if (platform === "win32") {
			writeFileSync(staged, bytes);
		} else {
			const archive = join(temporary, basename(assetName));
			writeFileSync(archive, bytes);
			const extracted = join(temporary, "extracted");
			mkdirSync(extracted);
			const result = spawnSync("tar", ["-xzf", archive, "-C", extracted], { stdio: "inherit" });
			signal?.throwIfAborted();
			if (result.status !== 0) throw new Error("failed to extract code-mode host archive");
			const candidates = walk(extracted).filter((path) => basename(path).startsWith("codex-code-mode-host"));
			if (candidates.length !== 1) throw new Error(`expected one code-mode host binary, found ${candidates.length}`);
			copyFileSync(candidates[0]!, staged);
			chmodSync(staged, 0o755);
		}
		renameSync(staged, destination);
	} finally {
		rmSync(staged, { force: true });
		rmSync(temporary, { recursive: true, force: true });
		rmSync(lockPath, { recursive: true, force: true });
	}
}

async function acquireInstallLock(lockPath: string, destination: string, signal: AbortSignal | undefined): Promise<boolean> {
	const deadline = Date.now() + INSTALL_LOCK_TIMEOUT_MS;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		if (existsSync(destination)) return false;
		try {
			mkdirSync(lockPath);
			return true;
		} catch (error) {
			if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > INSTALL_LOCK_STALE_MS) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
			} catch (statError) {
				if (!statError || typeof statError !== "object" || !("code" in statError) || statError.code !== "ENOENT") throw statError;
			}
			await delay(INSTALL_LOCK_POLL_MS, undefined, signal ? { signal } : undefined);
		}
	}
	if (existsSync(destination)) return false;
	throw new Error(`timed out waiting for code-mode host install lock: ${lockPath}`);
}

function walk(dir: string): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) paths.push(...walk(path));
		else paths.push(path);
	}
	return paths;
}
