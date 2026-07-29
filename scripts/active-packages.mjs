import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const archivedPackageDirs = new Set(["pi-codex-conversion-lite"]);

export function isActivePackageDir(dir) {
  return !archivedPackageDirs.has(dir);
}

export function listActivePackageDirs(root) {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir)
    .filter((dir) => isActivePackageDir(dir) && existsSync(join(packagesDir, dir, "package.json")))
    .sort();
}
