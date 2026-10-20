import { spawn } from "node:child_process";
import type { TabBundle } from "./bundle.ts";

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const TERMINATION_GRACE_MS = 500;

export interface CollectorRun {
	result: Promise<{ data: unknown; json: string }>;
	stop(): void;
}

export function runCollector(
	bundle: TabBundle,
	stateDirectory: string,
	sessions: string,
): CollectorRun {
	const [command, ...args] = bundle.manifest.collector;
	if (!command) throw new Error("Collector command is missing");
	const child = spawn(command, args, {
		cwd: bundle.root,
		shell: false,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			OBSERVATORY_SESSIONS_DIR: sessions,
			OBSERVATORY_STATE_DIR: stateDirectory,
			OBSERVATORY_TAB_ID: bundle.manifest.id,
		},
	});
	let failure: string | null = null;
	let finished = false;
	let killTimer: NodeJS.Timeout | undefined;
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	let stdoutBytes = 0;
	let stderrBytes = 0;

	const signalGroup = (signal: NodeJS.Signals) => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, signal);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				failure ??= `Could not stop collector process group: ${String(error)}`;
		}
	};
	const terminate = (reason: string) => {
		if (finished) return;
		failure ??= reason;
		if (killTimer) return;
		signalGroup("SIGTERM");
		killTimer = setTimeout(() => {
			signalGroup("SIGKILL");
			// Unsupported detached daemons must not retain our pipes indefinitely.
			child.stdout.destroy();
			child.stderr.destroy();
		}, TERMINATION_GRACE_MS);
	};
	const timeout = setTimeout(
		() =>
			terminate(
				`Collector timed out after ${bundle.manifest.timeoutSeconds}s. Finish sooner or increase timeoutSeconds (maximum 300).`,
			),
		bundle.manifest.timeoutSeconds * 1000,
	);

	const result = new Promise<{ data: unknown; json: string }>(
		(resolve, reject) => {
			child.stdout.on("data", (chunk: Buffer) => {
				stdoutBytes += chunk.length;
				if (stdoutBytes > MAX_SNAPSHOT_BYTES)
					terminate(
						"Collector stdout exceeded 4 MiB. Emit a smaller JSON snapshot.",
					);
				else if (!failure) stdout.push(chunk);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderrBytes += chunk.length;
				if (stderrBytes > MAX_STDERR_BYTES)
					terminate(
						"Collector stderr exceeded 64 KiB. Reduce collector logging.",
					);
				else stderr.push(chunk);
			});
			child.stdout.on("error", (error) =>
				terminate(`Could not read collector stdout: ${error.message}`),
			);
			child.stderr.on("error", (error) =>
				terminate(`Could not read collector stderr: ${error.message}`),
			);
			child.on("error", (error) => {
				failure ??= `Could not start collector ${command}: ${error.message}. Check the command and executable permissions.`;
			});
			child.once("close", (code, signal) => {
				finished = true;
				clearTimeout(timeout);
				clearTimeout(killTimer);
				// Foreground collectors may not leave background children behind.
				signalGroup("SIGKILL");
				child.stdout.destroy();
				child.stderr.destroy();
				if (code !== 0)
					failure ??= `Collector exited ${signal ? `with signal ${signal}` : `with code ${code}`}. Fix the collector command.`;
				if (failure) {
					const logs = Buffer.concat(stderr)
						.toString("utf8")
						.trim()
						.slice(-2048);
					reject(new Error(`${failure}${logs ? ` Stderr: ${logs}` : ""}`));
					return;
				}
				try {
					const json = new TextDecoder("utf-8", { fatal: true }).decode(
						Buffer.concat(stdout),
					);
					resolve({ data: JSON.parse(json), json });
				} catch {
					reject(
						new Error(
							"Collector stdout must contain exactly one JSON value. Send logs to stderr.",
						),
					);
				}
			});
		},
	);
	return {
		result,
		stop: () => terminate("Collector stopped because Observatory is closing."),
	};
}
