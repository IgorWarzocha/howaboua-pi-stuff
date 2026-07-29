#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listActivePackageDirs } from "./active-packages.mjs";

const root = process.cwd();
const packagesDir = join(root, "packages");
const changelogPath = join(root, "CHANGELOG.md");
const marker = "<!-- package-changelog-summary -->";

const current = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "# Changelog\n";
const intro = current.includes(marker) ? current.slice(0, current.indexOf(marker)).trimEnd() : current.trimEnd();

function firstVersionSection(text) {
  const match = text.match(/^##\s+(.+)$/m);
  if (!match || match.index === undefined) return undefined;
  const start = match.index;
  const rest = text.slice(start + match[0].length);
  const next = rest.search(/^##\s+/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  return { heading: match[1].trim(), body: body.trim() };
}

const packageSummaries = [];
for (const dir of listActivePackageDirs(root)) {
  const packageJsonPath = join(packagesDir, dir, "package.json");
  const packageChangelogPath = join(packagesDir, dir, "CHANGELOG.md");
  if (!existsSync(packageJsonPath) || !existsSync(packageChangelogPath)) continue;
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const changelog = readFileSync(packageChangelogPath, "utf8");
  const latest = firstVersionSection(changelog);
  if (!latest) continue;
  packageSummaries.push({ name: pkg.name ?? dir, dir, latest });
}

let generated = `${marker}\n\n## Latest package changelogs\n\n`;
if (packageSummaries.length === 0) {
  generated += "No package changelogs found yet.\n";
} else {
  for (const entry of packageSummaries) {
    generated += `### ${entry.name} — ${entry.latest.heading}\n\n`;
    generated += `${entry.latest.body || "See package changelog."}\n\n`;
    generated += `[Full changelog](./packages/${entry.dir}/CHANGELOG.md)\n\n`;
  }
}

writeFileSync(changelogPath, `${intro}\n\n${generated}`);
console.log(`Updated ${changelogPath}`);
