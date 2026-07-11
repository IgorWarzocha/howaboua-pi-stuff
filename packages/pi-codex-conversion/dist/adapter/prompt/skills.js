import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
export function getCodexSkillPaths(cwd, home = homedir()) {
    const skillPaths = [join(home, ".agents", "skills")];
    let currentDir = resolve(cwd);
    while (true) {
        skillPaths.push(join(currentDir, ".agents", "skills"));
        const parentDir = resolve(currentDir, "..");
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }
    return skillPaths.filter((path) => existsSync(path));
}
export function hasNoSkillsFlag(argv = process.argv) {
    for (const arg of argv) {
        if (arg === "--")
            return false;
        if (arg === "--no-skills" || arg === "-ns")
            return true;
    }
    return false;
}
