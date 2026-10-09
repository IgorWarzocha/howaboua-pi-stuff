#!/usr/bin/env node
import { statSync } from "node:fs";

const missing = [];
for (const platform of ["linux", "darwin", "win32"]) {
	for (const arch of ["x64", "arm64"]) {
		const target = `${platform}-${arch}`;
		const filename = platform === "win32" ? "grok-audio.exe" : "grok-audio";
		for (const file of [filename, "LICENSES.txt"]) {
			const path = new URL(
				`../src/audio/bin/${target}/${file}`,
				import.meta.url,
			);
			try {
				const stat = statSync(path);
				if (!stat.isFile() || stat.size === 0)
					missing.push(`${target}/${file}`);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				missing.push(`${target}/${file}`);
			}
		}
	}
}
if (missing.length) {
	throw new Error(
		`Missing bundled Grok audio binaries: ${missing.join(", ")}. Run the Build Grok audio binaries workflow on the source branch and merge its binary commit before publishing.`,
	);
}
console.log("All six Grok audio binaries are bundled");
