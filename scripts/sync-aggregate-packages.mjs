#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const aggregateDirs = new Set(["pi-stuff", "pi-skills", "pi-extensions"]);
const bundleExcludedPackages = new Set(["@howaboua/pi-codex-conversion", "@howaboua/pi-skill-omarchy-help"]);
const packages = readdirSync(packagesDir)
  .filter((dir) => !aggregateDirs.has(dir) && existsSync(join(packagesDir, dir, "package.json")))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8")) }))
  .filter((entry) => !bundleExcludedPackages.has(entry.pkg.name))
  .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));

function has(kind, entry) {
  return Array.isArray(entry.pkg.pi?.[kind]) && entry.pkg.pi[kind].length > 0;
}

function dependencyMap(filter) {
  const out = {};
  for (const entry of packages.filter(filter)) out[entry.pkg.name] = entry.pkg.version;
  return out;
}

function safeIdentifier(packageName) {
  return packageName
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[^a-zA-Z_$]/, "extension");
}

function writeExtensionAggregate(dir, filter) {
  rmSync(join(packagesDir, dir, "extensions"), { recursive: true, force: true });
  const extensionEntries = packages.filter(filter).filter((entry) => has("extensions", entry));
  const imports = extensionEntries.map((entry) => `import ${safeIdentifier(entry.pkg.name)} from "${entry.pkg.name}";`);
  const calls = extensionEntries.map((entry) => `\tawait ${safeIdentifier(entry.pkg.name)}(pi);`);
  writeFileSync(
    join(packagesDir, dir, "index.ts"),
    `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n${imports.join("\n")}\n\nexport default async function (pi: ExtensionAPI) {\n${calls.join("\n")}\n}\n`,
  );
  return ["./index.ts"];
}

function dependencyResourcePath(dependencyName, resource) {
  const cleanedResource = resource.replace(/^\.\//, "");
  return posix.join("..", dependencyName.replace(/^@howaboua\//, ""), cleanedResource);
}

function skillPaths(filter) {
  const paths = [];
  for (const entry of packages.filter(filter)) {
    for (const resource of entry.pkg.pi?.skills ?? []) paths.push(dependencyResourcePath(entry.pkg.name, resource));
  }
  return paths;
}

function updateAggregate(dir, filter, includeExtensions, includeSkills) {
  const file = join(packagesDir, dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.dependencies = dependencyMap(filter);
  delete pkg.bundledDependencies;
  pkg.files = Array.from(new Set([...(pkg.files ?? []).filter((entry) => entry !== "extensions"), "index.ts", "README.md", "LICENSE"]));
  pkg.pi = {};
  if (includeExtensions) pkg.pi.extensions = writeExtensionAggregate(dir, filter);
  if (includeSkills) pkg.pi.skills = skillPaths(filter);
  writeFileSync(file, JSON.stringify(pkg, null, "\t") + "\n");
}

updateAggregate("pi-stuff", () => true, true, true);
updateAggregate("pi-extensions", (entry) => has("extensions", entry), true, false);
updateAggregate("pi-skills", (entry) => has("skills", entry), false, true);
console.log("Synced aggregate package dependencies and Pi resource paths.");
