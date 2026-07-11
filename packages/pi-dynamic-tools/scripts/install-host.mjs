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
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { HOST_ASSETS, hostAssetUrl } from "./host-assets.mjs";

const platform = `${process.platform}-${process.arch}`;
const asset = HOST_ASSETS[platform];
if (!asset) {
	console.error(`[pi-dynamic-tools] Unsupported platform: ${platform}`);
	process.exit(1);
}
const [assetName, expectedSha256] = asset;
const packageRoot = resolve(import.meta.dirname, "..");
const outDir = join(packageRoot, "bin", platform);
const binaryName =
	process.platform === "win32"
		? "codex-code-mode-host.exe"
		: "codex-code-mode-host";
const destination = join(outDir, binaryName);
if (existsSync(destination)) process.exit(0);

const temporary = mkdtempSync(join(tmpdir(), "pi-dynamic-tools-"));
try {
	const response = await fetch(hostAssetUrl(assetName), { redirect: "follow" });
	if (!response.ok)
		throw new Error(
			`download failed: ${response.status} ${response.statusText}`,
		);
	const bytes = Buffer.from(await response.arrayBuffer());
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expectedSha256)
		throw new Error(`checksum mismatch for ${assetName}`);
	mkdirSync(outDir, { recursive: true });
	if (process.platform === "win32") {
		writeFileSync(destination, bytes);
	} else {
		const archive = join(temporary, basename(assetName));
		writeFileSync(archive, bytes);
		const extracted = join(temporary, "extracted");
		mkdirSync(extracted);
		const result = spawnSync("tar", ["-xzf", archive, "-C", extracted], {
			stdio: "inherit",
		});
		if (result.status !== 0)
			throw new Error("failed to extract code-mode host archive");
		const candidates = walk(extracted).filter((path) =>
			basename(path).startsWith("codex-code-mode-host"),
		);
		if (candidates.length !== 1)
			throw new Error(
				`expected one code-mode host binary, found ${candidates.length}`,
			);
		copyFileSync(candidates[0], destination);
		chmodSync(destination, 0o755);
	}
	console.log(`[pi-dynamic-tools] Installed ${destination}`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
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
