#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const [name, version, tag] = process.argv.slice(2);
const previewVersion = /^\d+\.\d+\.\d+-(dev|core)\.[1-9]\d*\.[1-9]\d*\.g[a-f0-9]{12}$/;
const channel = previewVersion.exec(version ?? "")?.[1];
if (!/^@howaboua\/pi-[a-z0-9-]+$/.test(name ?? "") || !channel || channel !== tag) {
	throw new Error("Expected a package name, preview version and matching dev or core tag.");
}

function npm(args) {
	const result = spawnSync("npm", args, { encoding: "utf8" });
	if (result.error) throw result.error;
	return result;
}

let removedLatest = false;
for (let attempt = 0; attempt < 15; attempt++) {
	const result = npm(["view", name, "dist-tags", "--json", "--prefer-online"]);
	const tags = JSON.parse(result.stdout || "{}");
	if (result.status !== 0 && tags.error?.code !== "E404") {
		throw new Error(result.stderr || `Could not read ${name}'s npm tags.`);
	}
	if (result.status === 0 && tags[tag] === version) {
		if (previewVersion.test(tags.latest ?? "")) {
			// npm can assign latest as well as the requested tag on a first publication.
			// Never remove an existing stable latest version.
			if (!removedLatest) {
				const removed = npm(["dist-tag", "rm", name, "latest"]);
				if (removed.status !== 0) throw new Error(removed.stderr || `Could not remove ${name}'s preview latest tag.`);
				removedLatest = true;
			}
		} else {
			console.log(`Verified ${name}@${version} on @${tag}; latest is ${tags.latest ?? "unset"}.`);
			process.exit(0);
		}
	}
	if (attempt < 14) await setTimeout(20_000);
}
throw new Error(`${name}@${version} is not yet verified on @${tag} without a preview latest tag. Inspect npm dist-tags before retrying.`);
