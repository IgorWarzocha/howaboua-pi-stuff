import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { denoAssetUrl, DENO_VERSION, resolveDenoAsset } from "./deno-assets.ts";

const DOWNLOAD_TIMEOUT_MS = 180_000;
const INSTALL_LOCK_TIMEOUT_MS = 185_000;
const INSTALL_LOCK_STALE_MS = 240_000;
const INSTALL_LOCK_POLL_MS = 200;
const dynamicImport = (specifier: string) => import(specifier);

export interface DenoBinaryRuntime {
	platform: string;
	arch: string;
	agentDir: string;
}

export async function ensureNotebookDenoBinary(
	overrides: Partial<Omit<DenoBinaryRuntime, "agentDir">> & Pick<DenoBinaryRuntime, "agentDir">,
	signal?: AbortSignal,
): Promise<string> {
	const runtime: DenoBinaryRuntime = {
		platform: overrides.platform ?? process.platform,
		arch: overrides.arch ?? process.arch,
		agentDir: overrides.agentDir,
	};
	const destination = join(
		runtime.agentDir,
		"cache",
		"pi-codex-conversion",
		"notebook-mode",
		`deno-${DENO_VERSION}`,
		`${runtime.platform}-${runtime.arch}`,
		"deno",
	);
	if (existsSync(destination)) return destination;
	await installDeno(destination, runtime, signal);
	return destination;
}

async function installDeno(
	destinationInput: string,
	runtime: DenoBinaryRuntime,
	signal?: AbortSignal,
): Promise<void> {
	const [asset, expectedSha256] = resolveDenoAsset(runtime.platform, runtime.arch);
	const destination = resolve(destinationInput);
	if (basename(destination) !== "deno") throw new Error("Deno destination must end with deno");
	mkdirSync(resolve(destination, ".."), { recursive: true });
	const lockPath = `${destination}.lock`;
	if (!(await acquireLock(lockPath, destination, signal))) return;
	const temporary = mkdtempSync(join(tmpdir(), "pi-codex-deno-"));
	const staged = `${destination}.${process.pid}.tmp`;
	try {
		const url = denoAssetUrl(asset);
		let bytes: Buffer;
		try {
			const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
			const { getProxyForUrl } = await dynamicImport("proxy-from-env") as { getProxyForUrl(url: string): string };
			const proxy = getProxyForUrl(url);
			const { ProxyAgent } = await dynamicImport("undici") as typeof import("undici");
			const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
			try {
				const response = await globalThis.fetch(url, {
					redirect: "follow",
					signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
					...(dispatcher ? { dispatcher } : {}),
				} as RequestInit & { dispatcher?: InstanceType<typeof ProxyAgent> });
				if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
				bytes = Buffer.from(await response.arrayBuffer());
			} finally {
				await dispatcher?.close();
			}
		} catch (error) {
			throw new Error(`failed to download pinned Deno ${DENO_VERSION}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		const actualSha256 = createHash("sha256").update(bytes).digest("hex");
		if (actualSha256 !== expectedSha256) throw new Error(`checksum mismatch for ${asset}`);
		const archive = join(temporary, asset);
		writeFileSync(archive, bytes);
		const extraction = spawnSync("unzip", ["-q", archive, "deno", "-d", temporary], { stdio: "inherit" });
		signal?.throwIfAborted();
		if (extraction.status !== 0) {
			throw new Error("failed to extract Deno archive; Notebook Code Mode requires the unzip command on Linux");
		}
		copyFileSync(join(temporary, "deno"), staged);
		chmodSync(staged, 0o755);
		renameSync(staged, destination);
	} finally {
		rmSync(staged, { force: true });
		rmSync(temporary, { recursive: true, force: true });
		rmSync(lockPath, { recursive: true, force: true });
	}
}

async function acquireLock(lockPath: string, destination: string, signal?: AbortSignal): Promise<boolean> {
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
	throw new Error(`timed out waiting for Deno install lock: ${lockPath}`);
}
