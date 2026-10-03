import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

interface ProcessRecord {
	pid: number;
	parent: number;
	state: string;
}

async function processSnapshot(): Promise<ProcessRecord[]> {
	const { stdout } = await promisify(execFile)(
		"ps",
		["-A", "-o", "pid=,ppid=,stat="],
		{
			timeout: 500,
			maxBuffer: 4 * 1024 * 1024,
			encoding: "utf8",
		},
	);
	return stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/);
			if (!match) throw new Error("Could not read setup process tree");
			return {
				pid: Number(match[1]),
				parent: Number(match[2]),
				state: match[3] ?? "",
			};
		});
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(pid, signal);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			error.code !== "ESRCH"
		)
			throw error;
	}
}

async function terminateSetupTree(pid: number): Promise<void> {
	if (process.platform === "win32") {
		await promisify(execFile)(
			join(
				process.env["SystemRoot"] ?? "C:\\Windows",
				"System32",
				"taskkill.exe",
			),
			["/F", "/T", "/PID", String(pid)],
			{ timeout: 3_000, windowsHide: true },
		);
		return;
	}
	// Keep the controlling TTY: detached:true would create a new session and
	// break OpenSSH's /dev/tty authentication. Freeze this tree, never Pi's PGID.
	const owned = new Set([pid]);
	try {
		sendSignal(pid, "SIGSTOP");
		let settled = false;
		for (let pass = 0; pass < 8; pass++) {
			const records = await processSnapshot();
			const before = owned.size;
			let found: boolean;
			do {
				found = false;
				for (const record of records) {
					if (owned.has(record.parent) && !owned.has(record.pid)) {
						owned.add(record.pid);
						sendSignal(record.pid, "SIGSTOP");
						found = true;
					}
				}
			} while (found);
			if (owned.size === before) {
				settled = true;
				break;
			}
		}
		if (!settled)
			throw new Error("Setup process tree did not settle for cancellation");
		for (const childPid of [...owned].reverse()) {
			sendSignal(childPid, "SIGTERM");
			sendSignal(childPid, "SIGCONT");
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	} finally {
		// Retain descendants after the parent exits and they are reparented.
		for (const childPid of [...owned].reverse())
			sendSignal(childPid, "SIGKILL");
	}
	for (let pass = 0; pass < 10; pass++) {
		const active = (await processSnapshot()).some(
			(record) => owned.has(record.pid) && !record.state.startsWith("Z"),
		);
		if (!active) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Setup process tree is still running after cancellation");
}

export async function runSetupProcess(
	binary: string,
	args: string[],
	signal: AbortSignal,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	signal.throwIfAborted();
	const child = spawn(binary, args, {
		shell: false,
		stdio: "inherit",
		env: process.env,
	});
	let cleanup: Promise<void> | undefined;
	let cleanupError: unknown;
	const abort = () => {
		if (cleanup || child.pid === undefined) return;
		cleanup = terminateSetupTree(child.pid).catch((error) => {
			cleanupError = error;
			child.kill("SIGKILL");
		});
	};
	const completed = new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, childSignal) =>
			resolve({ code, signal: childSignal }),
		);
	});
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	try {
		return await completed;
	} finally {
		signal.removeEventListener("abort", abort);
		await cleanup;
		if (cleanupError)
			throw new Error(
				`Setup process cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
				{ cause: cleanupError },
			);
	}
}
