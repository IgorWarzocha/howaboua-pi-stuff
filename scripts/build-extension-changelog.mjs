#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";

const packageArgument = process.argv[2];
if (!packageArgument) {
	console.error("Usage: node scripts/build-extension-changelog.mjs <package-dir>");
	process.exit(1);
}

const packageRoot = resolve(packageArgument);
const sourcePath = resolve(packageRoot, "changelog.ts");
const outputPath = resolve(packageRoot, "changelog.js");
const source = readFileSync(sourcePath, "utf8");
const output = stripTypeScriptTypes(source, {
	mode: "strip",
});
writeFileSync(outputPath, output);
