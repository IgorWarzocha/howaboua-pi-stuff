import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
const result = spawnSync("tsc", ["-p", "tsconfig.build.json"], {
	stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
cpSync("src/docs", "dist/src/docs", { recursive: true });
chmodSync("dist/src/git-askpass.js", 0o755);
