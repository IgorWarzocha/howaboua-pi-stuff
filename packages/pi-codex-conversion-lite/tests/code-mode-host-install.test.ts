import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { ensureCodeModeHostBinary } from "../src/tools/code-mode/binary.ts";
import { resolveCodeModeHostAsset } from "../src/tools/code-mode/host-assets.ts";

const platforms = [
	["darwin", "arm64", "codex-code-mode-host-aarch64-apple-darwin.tar.gz", "codex-code-mode-host"],
	["darwin", "x64", "codex-code-mode-host-x86_64-apple-darwin.tar.gz", "codex-code-mode-host"],
	["linux", "arm64", "codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz", "codex-code-mode-host"],
	["linux", "x64", "codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz", "codex-code-mode-host"],
	["win32", "arm64", "codex-code-mode-host-aarch64-pc-windows-msvc.exe", "codex-code-mode-host.exe"],
	["win32", "x64", "codex-code-mode-host-x86_64-pc-windows-msvc.exe", "codex-code-mode-host.exe"],
] as const;

test("Code Mode installs its host in-process for every supported platform", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-codex-host-install-"));
	try {
		for (const [platform, arch, assetName, binaryName] of platforms) {
			const packageRoot = join(root, "package", `${platform}-${arch}`);
			const agentDir = join(root, "agent", `${platform}-${arch}`);
			let installs = 0;
			const binary = await ensureCodeModeHostBinary(undefined, {
				platform,
				arch,
				packageRoot,
				agentDir,
				install: async (options) => {
					installs += 1;
					assert.equal(options.platform, platform);
					assert.equal(options.arch, arch);
					assert.equal(options.destination, join(agentDir, "cache", "pi-codex-conversion-lite", "code-mode", "rust-v0.145.0", `${platform}-${arch}`, binaryName));
					await mkdir(dirname(options.destination), { recursive: true });
					await writeFile(options.destination, "host");
				},
			});
			assert.equal(installs, 1);
			assert.equal(binary, join(agentDir, "cache", "pi-codex-conversion-lite", "code-mode", "rust-v0.145.0", `${platform}-${arch}`, binaryName));
			assert.equal(resolveCodeModeHostAsset(platform, arch)[0], assetName);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
