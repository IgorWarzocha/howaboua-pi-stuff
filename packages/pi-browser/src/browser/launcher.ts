import { spawn } from "node:child_process";
import { probeDebugPort, sleep } from "../cdp/discovery.js";

const BROWSER_START_TIMEOUT_MS = 10_000;
const BROWSER_UNIT = "chrome-cdp-browser.service";
const PROCESS_OUTPUT_LIMIT = 1 * 1_024 * 1_024;

interface ProcessResult {
	code: number;
	stdout: string;
	stderr: string;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new Error("Browser launch aborted");
}

export function runProcess(
	command: string,
	args: string[],
	signal?: AbortSignal,
): Promise<ProcessResult> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolveValue, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let bytes = 0;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (killTimer) clearTimeout(killTimer);
			signal?.removeEventListener("abort", abort);
		};
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			action();
		};
		const running = () => child.exitCode === null && child.signalCode === null;
		const abort = () => {
			if (running()) child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (running()) child.kill("SIGKILL");
			}, 1_000);
			killTimer.unref?.();
		};
		const append = (target: "stdout" | "stderr", chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > PROCESS_OUTPUT_LIMIT) {
				if (running()) child.kill("SIGKILL");
				finish(() => reject(new Error("Browser launch output exceeded 1 MiB")));
				return;
			}
			if (target === "stdout") stdout += chunk.toString("utf8");
			else stderr += chunk.toString("utf8");
		};
		child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) =>
			finish(() => {
				if (signal?.aborted) {
					reject(abortReason(signal));
					return;
				}
				resolveValue({
					code: code ?? 1,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
				});
			}),
		);
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function endpoint(): { port: string; host: string } {
	return {
		port: process.env["CDP_PORT"] ?? "9222",
		host: process.env["CDP_HOST"] ?? "127.0.0.1",
	};
}

async function waitForDebugEndpoint(
	signal?: AbortSignal,
	timeout = BROWSER_START_TIMEOUT_MS,
): Promise<void> {
	const { port, host } = endpoint();
	const deadline = Date.now() + timeout;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			await probeDebugPort(port, host);
			return;
		} catch (error) {
			lastError = error;
		}
		await sleep(100, signal);
	}
	throw new Error(
		`Browser did not expose CDP at ${host}:${port} within ${timeout}ms${
			lastError instanceof Error ? ` (${lastError.message})` : ""
		}`,
	);
}

async function unitExists(
	systemctl: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const result = await runProcess(
		systemctl,
		["--user", "show", BROWSER_UNIT, "--property=LoadState", "--value"],
		signal,
	);
	return result.code === 0 && result.stdout !== "not-found";
}

async function waitForBrowserOrUnitRemoval(
	systemctl: string,
	signal?: AbortSignal,
): Promise<"browser" | "removed" | "timeout"> {
	const { port, host } = endpoint();
	const deadline = Date.now() + BROWSER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			await probeDebugPort(port, host);
			return "browser";
		} catch {
			// The transient unit may still be starting.
		}
		if (!(await unitExists(systemctl, signal))) return "removed";
		await sleep(100, signal);
	}
	return "timeout";
}

export async function startBrowser(signal?: AbortSignal): Promise<string> {
	const { port, host } = endpoint();
	try {
		await probeDebugPort(port, host);
		return `Browser already running with CDP at ${host}:${port}`;
	} catch {
		// Continue into platform launch.
	}
	if (process.platform !== "linux") {
		throw new Error(
			"Automatic browser launch requires a Linux systemd user session. Start the authenticated browser normally with remote debugging enabled.",
		);
	}
	const systemctl = process.env["CDP_SYSTEMCTL"] ?? "/usr/bin/systemctl";
	const systemdRun = process.env["CDP_SYSTEMD_RUN"] ?? "/usr/bin/systemd-run";
	const browser = process.env["CDP_BROWSER"] ?? "/usr/bin/chromium";
	let lastLaunchError = "";
	for (let attempt = 0; attempt < 3; attempt++) {
		const state = await waitForBrowserOrUnitRemoval(systemctl, signal);
		if (state === "browser") {
			return `Browser already running with CDP at ${host}:${port}`;
		}
		if (state === "timeout") {
			throw new Error(
				`Browser unit ${BROWSER_UNIT} remained loaded without exposing CDP at ${host}:${port}`,
			);
		}
		await runProcess(
			systemctl,
			["--user", "reset-failed", BROWSER_UNIT],
			signal,
		);
		const browserArgs = [
			`--remote-debugging-address=${host}`,
			`--remote-debugging-port=${port}`,
		];
		const profile = process.env["CDP_PROFILE_DIRECTORY"];
		if (profile) {
			browserArgs.push(`--profile-directory=${profile}`);
		}
		browserArgs.push("about:blank");
		const launched = await runProcess(
			systemdRun,
			[
				"--user",
				"--unit=chrome-cdp-browser",
				"--collect",
				"--property=Type=exec",
				"--property=Restart=no",
				browser,
				...browserArgs,
			],
			signal,
		);
		if (launched.code === 0) {
			await waitForDebugEndpoint(signal);
			return `Started authenticated browser with CDP at ${host}:${port}`;
		}
		lastLaunchError =
			launched.stderr || launched.stdout || `exit ${launched.code}`;
	}
	throw new Error(
		`Could not launch the browser through the graphical user session: ${lastLaunchError}`,
	);
}
