import { spawnSync } from "node:child_process";
import {
	cpSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

rmSync("dist", { recursive: true, force: true });
const result = spawnSync("tsgo", ["-p", "tsconfig.build.json"], {
	stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
for (const path of ["web", "tabs", "examples", "docs", "investigate.md"]) {
	cpSync(path, join("dist", path), {
		recursive: true,
		filter: (path) =>
			!path.endsWith(".ts") &&
			(!path.endsWith(".js") || path.startsWith("examples/")) &&
			!path.endsWith("AGENTS.md"),
	});
}
for (const tab of readdirSync("tabs")) {
	const path = join("dist", "tabs", tab, "tab.json");
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	for (const key of ["collector", "query"]) {
		if (manifest[key]) {
			manifest[key] = manifest[key].map((arg) =>
				arg.endsWith(".ts") ? `${arg.slice(0, -3)}.js` : arg,
			);
		}
	}
	writeFileSync(path, `${JSON.stringify(manifest, null, "\t")}\n`);
}
cpSync("README.md", "dist/README.md");
