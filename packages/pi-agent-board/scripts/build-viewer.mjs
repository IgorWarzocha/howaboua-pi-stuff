import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
const result = spawnSync("tsc", ["-p", "tsconfig.viewer.json"], {
	stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
cpSync("src/viewer/web", "dist/viewer/web", { recursive: true });
