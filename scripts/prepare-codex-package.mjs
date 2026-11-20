import { spawnSync } from "node:child_process";

// npm publish (including dry-run) has already built and verified these files
// in prepublishOnly. Source installs and standalone packs still need a build.
if (process.env.npm_command !== "publish") {
	const result = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
}
