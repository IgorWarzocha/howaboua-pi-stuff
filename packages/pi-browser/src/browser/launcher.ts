import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { probeDebugPort, sleep } from "../cdp/discovery.js";
import { asRecord } from "../cdp/types.js";
import { resolveDefaultBrowser } from "./default-browser.js";

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

function runProcess(
	command: string,
	args: string[],
	signal?: AbortSignal,
	env?: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	return new Promise((resolveValue, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
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
		}. The browser may not support CDP startup flags or may have refused remote debugging for this profile. Enable remote debugging in the existing browser or set CDP_BROWSER to a compatible executable.`,
	);
}

function hasGraphicalDesktop(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env["XDG_CURRENT_DESKTOP"]?.trim() &&
		(env["WAYLAND_DISPLAY"] || env["DISPLAY"]),
	);
}

async function graphicalEnvironment(
	signal: AbortSignal,
): Promise<NodeJS.ProcessEnv> {
	if (!process.env["SSH_CONNECTION"] && hasGraphicalDesktop(process.env)) {
		return { ...process.env };
	}
	// The remote worker inherits SSH's environment, which can select a
	// different MIME association from the graphical systemd user session.
	const result = await runProcess(
		"busctl",
		[
			"--user",
			"--json=short",
			"get-property",
			"org.freedesktop.systemd1",
			"/org/freedesktop/systemd1",
			"org.freedesktop.systemd1.Manager",
			"Environment",
		],
		signal,
	);
	if (result.code !== 0)
		throw new Error("systemd user environment unavailable");
	const reply = asRecord(JSON.parse(result.stdout), "systemd user environment");
	if (reply["type"] !== "as" || !Array.isArray(reply["data"])) {
		throw new Error("Invalid systemd user environment");
	}
	const entries: [string, string][] = [];
	for (const assignment of reply["data"]) {
		if (typeof assignment !== "string")
			throw new Error("Invalid systemd environment variable");
		const equals = assignment.indexOf("=");
		if (equals <= 0) throw new Error("Invalid systemd environment variable");
		entries.push([assignment.slice(0, equals), assignment.slice(equals + 1)]);
	}
	const env = Object.fromEntries(entries);
	if (!hasGraphicalDesktop(env))
		throw new Error("systemd has no graphical desktop environment");
	return env;
}

async function configuredDefaultBrowser(signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(5_000);
	const lookupSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let env: NodeJS.ProcessEnv;
	try {
		env = await graphicalEnvironment(lookupSignal);
	} catch (error) {
		signal?.throwIfAborted();
		throw new Error(
			"Could not determine the graphical desktop environment. Set CDP_BROWSER or start a browser with CDP enabled yourself.",
			{ cause: error },
		);
	}
	// xdg-settings uses the shell's BROWSER setting ahead of desktop
	// associations on generic desktops.
	delete env["BROWSER"];
	let id: string;
	try {
		const result = await runProcess(
			"xdg-settings",
			["get", "default-web-browser"],
			lookupSignal,
			env,
		);
		if (result.code !== 0)
			throw new Error(result.stderr || `exit ${result.code}`);
		id = result.stdout;
	} catch (error) {
		signal?.throwIfAborted();
		throw new Error(
			"Could not query the configured default browser with xdg-settings. Set CDP_BROWSER or start a browser with CDP enabled yourself.",
			{ cause: error },
		);
	}
	return resolveDefaultBrowser(id, env);
}

async function browserLaunchCommand(
	host: string,
	port: string,
	signal?: AbortSignal,
): Promise<string[]> {
	const switches = new Map([
		["--remote-debugging-address", host],
		["--remote-debugging-port", port],
	]);
	const profile = process.env["CDP_PROFILE_DIRECTORY"];
	if (profile) switches.set("--profile-directory", profile);
	const override = process.env["CDP_BROWSER"];
	if (override === "") {
		throw new Error("CDP_BROWSER must name a compatible executable.");
	}
	const desktop = override
		? {
				executable: override,
				args: ["about:blank"],
				workingDirectory: undefined,
			}
		: await configuredDefaultBrowser(signal);
	const fromDesktop = new Set<string>();
	for (const arg of desktop.args) {
		if (arg === "--") {
			throw new Error(
				"The default browser's desktop command has an option separator, so CDP arguments cannot be appended safely. Set CDP_BROWSER or start the browser yourself with CDP enabled.",
			);
		}
		const [name = ""] = arg.split("=", 1);
		const key =
			name.startsWith("-") && !name.startsWith("--") ? `-${name}` : name;
		const value = arg.startsWith(name + "=") ? arg.slice(name.length + 1) : "";
		const configured = switches.get(key);
		if (
			key === "--remote-debugging-pipe" ||
			(configured !== undefined && configured !== value)
		) {
			throw new Error(
				`The default browser's desktop arguments conflict with ${key}. Adjust the CDP configuration or start the browser yourself.`,
			);
		}
		if (
			key === "--user-data-dir" &&
			!isAbsolute(value) &&
			!desktop.workingDirectory
		) {
			throw new Error(
				"The default browser uses a relative --user-data-dir without a desktop working directory. Start the browser yourself with CDP enabled.",
			);
		}
		fromDesktop.add(key);
	}
	const args = [
		// Only the selected entry knows its launcher's argument structure.
		// Keep its complete argument prefix and attempt CDP, then probe the port.
		...(override ? [] : desktop.args),
		...[...switches]
			.filter(([key]) => !fromDesktop.has(key))
			.map(([key, value]) => `${key}=${value}`),
		...(override ? desktop.args : []),
	];
	// systemd expands variables in ExecStart even without a shell. Preserve
	// dollar signs in the executable path itself without changing which file runs.
	const literalExecutable = desktop.executable.includes("$");
	return [
		...(desktop.workingDirectory
			? [`--property=WorkingDirectory=${desktop.workingDirectory}`]
			: []),
		...(literalExecutable ? ["--expand-environment=no"] : []),
		"--",
		desktop.executable,
		...(literalExecutable
			? args
			: args.map((arg) => arg.replaceAll("$", () => "$$"))),
	];
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
	let launchCommand: string[] | undefined;
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
		launchCommand ??= await browserLaunchCommand(host, port, signal);
		await runProcess(
			systemctl,
			["--user", "reset-failed", BROWSER_UNIT],
			signal,
		);
		const launched = await runProcess(
			systemdRun,
			[
				"--user",
				"--unit=chrome-cdp-browser",
				"--collect",
				"--property=Type=exec",
				"--property=Restart=no",
				...launchCommand,
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
