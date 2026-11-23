import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const readManifest = (path) => JSON.parse(readFileSync(path, "utf8"));
const sdkPrefix = "@earendil-works/pi-";
const codingAgent = sdkPrefix + "coding-agent";
const sdkVersions = readManifest(join(root, "package.json")).devDependencies;

function sdkVersion(name) {
	const version = sdkVersions[name];
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))
		throw new Error(
			`Pin ${name} to a released version in the root package.json.`,
		);
	return version;
}

export function piPeerDependencies(peers = {}) {
	return Object.fromEntries(
		Object.entries(peers).map(([name, range]) => [
			name,
			name.startsWith(sdkPrefix) ? `>=${sdkVersion(name)}` : range,
		]),
	);
}

function syncWorkspaceSdks(write) {
	const mismatches = [];
	for (const dir of listActivePackageDirs(root)) {
		const path = join(root, "packages", dir, "package.json");
		const pkg = readManifest(path);
		let changed = false;
		for (const field of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
		]) {
			for (const [name, current] of Object.entries(pkg[field] ?? {})) {
				if (!name.startsWith(sdkPrefix)) continue;
				const version = sdkVersion(name);
				const expected =
					field === "peerDependencies" ? `>=${version}` : version;
				if (current === expected) continue;
				changed = true;
				pkg[field][name] = expected;
				mismatches.push(`${dir} ${field}: ${name} ${current} → ${expected}`);
			}
		}
		if (changed && write)
			writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
	}
	if (mismatches.length && !write)
		throw new Error(
			`Pi SDK manifests are out of sync. Run bun run pi:sdk:sync.\n${mismatches.join("\n")}`,
		);
	if (mismatches.length) console.log(mismatches.join("\n"));
}

if (import.meta.main) {
	const [option, ...rest] = process.argv.slice(2);
	if (rest.length || (option && option !== "--write" && option !== "--latest"))
		throw new Error(
			"Usage: node scripts/pi-sdk-policy.mjs [--write | --latest]",
		);
	syncWorkspaceSdks(option === "--write");
	const pinned = sdkVersion(codingAgent);
	if (option === "--latest") {
		const latest = JSON.parse(
			execFileSync(
				"npm",
				["view", `${codingAgent}@latest`, "version", "--json"],
				{
					encoding: "utf8",
				},
			),
		);
		if (pinned !== latest)
			throw new Error(
				`Release requires Pi ${latest}; the root pins ${pinned}. Update the root Pi SDK pins, run bun run pi:sdk:sync, then refresh bun.lock.`,
			);
	}
	console.log(`Pi SDK manifests match the root pins (Pi ${pinned}).`);
}
