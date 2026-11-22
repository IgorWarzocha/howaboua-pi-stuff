import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { listActivePackageDirs } from "./active-packages.mjs";

// Verify the release checkout, not only the packages uploaded by this attempt.
// npm may have recorded every version before any tarball is downloadable.
const root = process.cwd();
const packages = new Map();
for (const dir of listActivePackageDirs(root)) {
	const {
		name,
		version,
		private: isPrivate,
	} = JSON.parse(
		readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
	);
	if (!isPrivate) packages.set(`${name}@${version}`, { name, version });
}

const registry =
	process.env.npm_config_registry ?? "https://registry.npmjs.org";
async function available({ name, version }) {
	const baseUrl = `${registry.replace(/\/$/, "")}/${encodeURIComponent(name)}/`;
	try {
		const metadata = await fetch(
			new URL(encodeURIComponent(version), baseUrl),
			{
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (!metadata.ok) {
			await metadata.body?.cancel();
			return `metadata HTTP ${metadata.status}`;
		}
		const { dist } = await metadata.json();
		if (!dist?.tarball) return "metadata has no tarball URL";
		const download = await fetch(dist.tarball, {
			headers: { Range: "bytes=0-0" },
			signal: AbortSignal.timeout(15_000),
		});
		if (!download.ok) {
			await download.body?.cancel();
			return `tarball HTTP ${download.status}`;
		}
		const reader = download.body?.getReader();
		if (!reader) return "tarball response has no body";
		try {
			const { value } = await reader.read();
			return value?.byteLength ? undefined : "tarball response is empty";
		} finally {
			await reader.cancel();
		}
	} catch (error) {
		return error.message;
	}
}

const deadline = performance.now() + 12 * 60_000;
while (packages.size) {
	const failures = await Promise.all(
		[...packages].map(async ([id, pkg]) => {
			const problem = await available(pkg);
			if (!problem) {
				packages.delete(id);
				console.log(`Download available: ${id}`);
			}
			return problem ? `${id}: ${problem}` : undefined;
		}),
	);
	if (!packages.size) break;
	const pending = failures.filter(Boolean).join("\n");
	if (performance.now() >= deadline)
		throw new Error(`npm downloads still unavailable:\n${pending}`);
	console.log(`Waiting for npm downloads:\n${pending}`);
	await setTimeout(20_000);
}
