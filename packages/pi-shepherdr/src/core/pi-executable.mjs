import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, resolve } from "node:path";

/** @param {string} cwd Resolve on the target so Core cannot mistake Pi for a template. */
export async function piExecutable(cwd) {
	const windows = process.platform === "win32";
	const suffixes = windows
		? (process.env["PATHEXT"] || ".COM;.EXE;.BAT;.CMD")
				.split(";")
				.filter(Boolean)
		: [""];
	for (const directory of (process.env["PATH"] || "").split(delimiter)) {
		for (const suffix of suffixes) {
			const path = resolve(cwd, directory || ".", `pi${suffix}`);
			try {
				if (!(await stat(path)).isFile()) continue;
				await access(path, windows ? constants.F_OK : constants.X_OK);
				return windows ? path.replaceAll("\\", "/") : path;
			} catch (error) {
				if (
					!error ||
					typeof error !== "object" ||
					!("code" in error) ||
					!["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code))
				)
					throw error;
			}
		}
	}
	throw new Error(
		"Pi is not on PATH on the target machine; install it before spawning an agent",
	);
}
