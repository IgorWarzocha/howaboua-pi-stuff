#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const packagesDir = join(root, "packages");
const template = join(root, "scripts", "templates", "extension-changelog.ts");
const embeddedChangelogPackages = new Set(["@howaboua/pi-codex-conversion"]);
let count = 0;

for (const dir of listActivePackageDirs(root)) {
	const packagePath = join(packagesDir, dir, "package.json");
	if (!existsSync(packagePath)) continue;
	const packageText = readFileSync(packagePath, "utf8");
	const pkg = JSON.parse(packageText);
	if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.length === 0)
		continue;
	if (!existsSync(join(packagesDir, dir, "CHANGELOG.md")))
		throw new Error(`${pkg.name ?? dir} has no CHANGELOG.md`);

	copyFileSync(template, join(packagesDir, dir, "changelog.ts"));
	pkg.files = Array.from(
		new Set([...(pkg.files ?? []), "changelog.ts", "CHANGELOG.md"]),
	);
	const extensionEntries = pkg.pi.extensions.filter((entry) => entry !== "./changelog.ts");
	pkg.pi.extensions = embeddedChangelogPackages.has(pkg.name)
		? extensionEntries
		: ["./changelog.ts", ...extensionEntries];
	pkg.peerDependencies = {
		...(pkg.peerDependencies ?? {}),
		...(!pkg.peerDependencies?.["@earendil-works/pi-tui"]
			? { "@earendil-works/pi-tui": "*" }
			: {}),
	};
	const indent = packageText.match(/\n([\t ]+)"/)?.[1] ?? "\t";
	writeFileSync(packagePath, `${JSON.stringify(pkg, null, indent)}\n`);
	count++;
}

console.log(`Synced changelog runtime into ${count} extension packages.`);
