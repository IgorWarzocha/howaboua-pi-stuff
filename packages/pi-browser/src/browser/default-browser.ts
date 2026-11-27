import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

interface DesktopBrowser {
	executable: string;
	args: string[];
	workingDirectory: string | undefined;
}

const RECOVERY =
	"Set CDP_BROWSER to a compatible executable, or start a browser with CDP enabled yourself.";

async function missingIsUndefined<T>(
	operation: Promise<T>,
): Promise<T | undefined> {
	try {
		return await operation;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error.code === "ENOENT" || error.code === "ENOTDIR")
		) {
			return undefined;
		}
		throw error;
	}
}

async function desktopFiles(directory: string, id: string): Promise<string[]> {
	const entries = await missingIsUndefined(
		readdir(directory, { withFileTypes: true }),
	);
	const paths: string[] = [];
	for (const entry of entries ?? []) {
		const path = join(directory, entry.name);
		if (entry.name === id && !entry.isDirectory()) {
			paths.push(path);
		} else if (entry.isDirectory() && id.startsWith(entry.name + "-")) {
			// Nested entries derive their IDs by replacing '/' with '-'.
			paths.push(
				...(await desktopFiles(path, id.slice(entry.name.length + 1))),
			);
		}
	}
	return paths;
}

async function findDesktopFile(
	id: string,
	env: NodeJS.ProcessEnv,
): Promise<string> {
	const userData = env["XDG_DATA_HOME"];
	const home = env["HOME"];
	const systemData = (env["XDG_DATA_DIRS"] || "/usr/local/share:/usr/share")
		.split(":")
		.filter(isAbsolute);
	const roots = [
		userData && isAbsolute(userData)
			? userData
			: join(home && isAbsolute(home) ? home : homedir(), ".local/share"),
		...systemData,
	];
	for (const root of roots) {
		const [path, ambiguous] = await desktopFiles(
			join(root, "applications"),
			id,
		);
		if (ambiguous) throw new Error("the desktop ID is ambiguous");
		if (path) return path;
	}
	throw new Error("the desktop entry was not found");
}

function desktopEntry(source: string): Map<string, string> {
	const entry = new Map<string, string>();
	let inDesktopEntry = false;
	for (const line of source.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) {
			if (inDesktopEntry) break;
			inDesktopEntry = trimmed === "[Desktop Entry]";
		} else if (inDesktopEntry && trimmed && !trimmed.startsWith("#")) {
			const equals = trimmed.indexOf("=");
			if (equals < 1) throw new Error("invalid desktop entry");
			const key = trimmed.slice(0, equals).trimEnd();
			if (entry.has(key)) throw new Error("duplicate desktop entry key");
			entry.set(key, trimmed.slice(equals + 1).trimStart());
		}
	}
	return entry;
}

function desktopString(value: string): string {
	const escapes: Record<string, string> = {
		s: " ",
		n: "\n",
		t: "\t",
		r: "\r",
		"\\": "\\",
	};
	return value.replace(/\\(.|$)/g, (_match, char: string) => {
		const replacement = escapes[char];
		if (replacement === undefined)
			throw new Error("invalid desktop entry escape");
		return replacement;
	});
}

function execArguments(line: string): string[] {
	// Desktop Entry quoting is not shell quoting. Accept literal words and
	// whole double-quoted arguments only; leave nonliteral launchers unsupported.
	const word =
		/(?:"(?:[^"\\]|\\["`$\\])*"|[^ \t\n\r"'\\><~|&;$*?#()`]+)(?=[ \t]|$)/y;
	const args: string[] = [];
	let hasInputField = false;
	for (let remaining = desktopString(line).trim(); remaining;) {
		const match = word.exec(remaining)?.[0];
		if (match === undefined)
			throw new Error("unsupported desktop Exec quoting");
		remaining = remaining.slice(match.length).trimStart();
		word.lastIndex = 0;
		if (args.length !== 0 && /^%[fFuU]$/.test(match)) {
			if (hasInputField) throw new Error("multiple desktop Exec input fields");
			hasInputField = true;
			continue; // No URL or file was requested.
		}
		const unquoted = match.startsWith('"')
			? match.slice(1, -1).replace(/\\(.)/gs, "$1")
			: match;
		args.push(
			unquoted.replace(/%%|%/g, (percent) => {
				if (percent === "%%") return "%";
				throw new Error("unsupported desktop Exec field code");
			}),
		);
	}
	return args;
}

async function executablePath(
	executable: string,
	env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	const candidates = isAbsolute(executable)
		? [executable]
		: executable.includes("/")
			? []
			: (env["PATH"] ?? "/usr/bin:/bin")
					.split(":")
					.filter(isAbsolute)
					.map((directory) => join(directory, executable));
	for (const path of candidates) {
		try {
			await access(path, constants.X_OK);
			if ((await stat(path)).isFile()) return path;
		} catch {
			// Keep looking on PATH when a candidate isn't executable.
		}
	}
	return undefined;
}

export async function resolveDefaultBrowser(
	id: string,
	env: NodeJS.ProcessEnv,
): Promise<DesktopBrowser> {
	if (!/^[A-Za-z0-9_.-]+\.desktop$/.test(id)) {
		throw new Error(
			"Could not determine the configured default browser. " + RECOVERY,
		);
	}
	try {
		const path = await findDesktopFile(id, env);
		if (!(await stat(path)).isFile())
			throw new Error("invalid desktop entry file");
		const entry = desktopEntry(await readFile(path, "utf8"));
		if (
			entry.get("Type") !== "Application" ||
			entry.get("Hidden") === "true" ||
			entry.get("Terminal") === "true" ||
			entry.get("DBusActivatable") === "true"
		) {
			throw new Error(
				"the desktop entry does not use direct application startup",
			);
		}
		const [command, ...args] = execArguments(entry.get("Exec") ?? "");
		if (!command || command.includes("=")) {
			throw new Error("the desktop entry has no valid executable");
		}
		const executable = await executablePath(command, env);
		const tryExec = desktopString(entry.get("TryExec") ?? "");
		if (!executable || (tryExec && !(await executablePath(tryExec, env)))) {
			throw new Error("the desktop executable is unavailable");
		}
		const workingDirectory =
			desktopString(entry.get("Path") ?? "") || undefined;
		if (workingDirectory && !isAbsolute(workingDirectory)) {
			throw new Error("the desktop working directory is not absolute");
		}
		return { executable, args, workingDirectory };
	} catch (error) {
		throw new Error(
			'Cannot start the default browser "' +
				id +
				'": ' +
				(error instanceof Error ? error.message : String(error)) +
				". " +
				RECOVERY,
			{ cause: error },
		);
	}
}
