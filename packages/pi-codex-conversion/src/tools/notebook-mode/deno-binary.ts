import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
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
	const [, , binarySha256, binaryBytes] = resolveDenoAsset(runtime.platform, runtime.arch);
	if (validDenoBinary(destination, binarySha256, binaryBytes)) return destination;
	rmSync(destination, { force: true });
	await installDeno(destination, runtime, signal);
	if (!validDenoBinary(destination, binarySha256, binaryBytes)) {
		throw new Error(`Deno ${DENO_VERSION} cache validation failed after installation`);
	}
	return destination;
}

async function installDeno(
	destinationInput: string,
	runtime: DenoBinaryRuntime,
	signal?: AbortSignal,
): Promise<void> {
	const [asset, expectedSha256, expectedBinarySha256, expectedBinaryBytes] = resolveDenoAsset(runtime.platform, runtime.arch);
	const destination = resolve(destinationInput);
	if (basename(destination) !== "deno") throw new Error("Deno destination must end with deno");
	mkdirSync(resolve(destination, ".."), { recursive: true });
	const lockPath = `${destination}.lock`;
	if (!(await acquireLock(lockPath, destination, signal))) return;
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
		const { Open } = await dynamicImport("unzipper") as {
			Open: { buffer(input: Buffer): Promise<{ files: Array<{ path: string; type?: string; buffer(): Promise<Buffer> }> }> };
		};
		const archive = await Open.buffer(bytes);
		const entry = archive.files.find((candidate) => candidate.path === "deno" && candidate.type !== "Directory");
		if (!entry) throw new Error("pinned Deno archive does not contain the deno executable");
		const binary = Buffer.from(await entry.buffer());
		signal?.throwIfAborted();
		if (binary.length !== expectedBinaryBytes || createHash("sha256").update(binary).digest("hex") !== expectedBinarySha256) {
			throw new Error("extracted Deno binary checksum mismatch");
		}
		writeFileSync(staged, binary, { mode: 0o755 });
		chmodSync(staged, 0o755);
		renameSync(staged, destination);
	} finally {
		rmSync(staged, { force: true });
		rmSync(lockPath, { recursive: true, force: true });
	}
}

function validDenoBinary(path: string, expectedSha256: string, expectedBytes: number): boolean {
	try {
		if (statSync(path).size !== expectedBytes) return false;
		return createHash("sha256").update(readFileSync(path)).digest("hex") === expectedSha256;
	} catch {
		return false;
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
