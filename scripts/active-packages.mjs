import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function listActivePackageDirs(root) {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir)
    .filter((dir) => existsSync(join(packagesDir, dir, "package.json")))
    .sort();
}
