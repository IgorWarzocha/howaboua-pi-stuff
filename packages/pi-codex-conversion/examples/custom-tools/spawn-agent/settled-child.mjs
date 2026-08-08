import { spawn, spawnSync } from "node:child_process";

const SETTLED_EXIT_GRACE_MS = 10_000;
const FORCE_KILL_GRACE_MS = 2_000;

export async function runSettledPi(args, options) {
	const child = spawn("pi", args, {
		...options,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "inherit", "pipe"],
	});
	let settled = false;
	let settledTimer;
	let forceTimer;
	let requestedExitCode;
	let control = "";
	const clearTimers = () => {
		clearTimeout(settledTimer);
		clearTimeout(forceTimer);
	};
	const signalChild = (signal) => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		if (process.platform === "win32" && signal === "SIGKILL" && child.pid) {
			spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
				windowsHide: true,
			});
			return;
		}
		if (process.platform !== "win32" && child.pid) {
			try {
				process.kill(-child.pid, signal);
				return;
			} catch {
				// The child may not have established its process group yet.
			}
		}
		child.kill(signal);
	};
	const terminateChild = () => {
		signalChild("SIGTERM");
		clearTimeout(forceTimer);
		forceTimer = setTimeout(() => signalChild("SIGKILL"), FORCE_KILL_GRACE_MS);
	};
	const scheduleSettledExit = () => {
		clearTimeout(settledTimer);
		settledTimer = setTimeout(terminateChild, SETTLED_EXIT_GRACE_MS);
	};
	const interrupt = (exitCode) => {
		requestedExitCode ??= exitCode;
		terminateChild();
	};
	const onSigint = () => interrupt(130);
	const onSigterm = () => interrupt(143);
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	child.stdout.on("data", (chunk) => {
		if (!process.stdout.write(chunk)) {
			child.stdout.pause();
			process.stdout.once("drain", () => child.stdout.resume());
		}
		if (settled) scheduleSettledExit();
	});
	child.stdio[3]?.on("data", (chunk) => {
		control += chunk.toString();
		if (!settled && control.includes("settled\n")) {
			settled = true;
			scheduleSettledExit();
		}
	});
	const code = await new Promise((resolveCode, reject) => {
		child.once("error", reject);
		child.once("close", (value) => {
			clearTimers();
			resolveCode(requestedExitCode ?? (settled ? 0 : (value ?? 1)));
		});
	});
	process.off("SIGINT", onSigint);
	process.off("SIGTERM", onSigterm);
	return code;
}
