import { spawn } from "node:child_process";
import type { TabBundle } from "./bundle.ts";

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const TERMINATION_GRACE_MS = 500;

export interface CommandRun {
	result: Promise<{ data: unknown; json: string }>;
	stop(reason?: string): void;
}

export type CollectorRun = CommandRun;

export class CommandError extends Error {
	readonly reason: "timeout" | "failure";

	constructor(message: string, reason: "timeout" | "failure" = "failure") {
		super(message);
		this.reason = reason;
	}
}

export function runCollector(
	bundle: TabBundle,
	stateDirectory: string,
	sessions: string,
): CollectorRun {
	return runCommand(bundle, stateDirectory, sessions, {
		argv: bundle.manifest.collector,
		label: "Collector",
		timeoutSeconds: bundle.manifest.timeoutSeconds,
	});
}

export function runQuery(
	bundle: TabBundle,
	stateDirectory: string,
	sessions: string,
	argv: string[],
	input: string,
): CommandRun {
	return runCommand(bundle, stateDirectory, sessions, {
		argv,
		label: "Query",
		timeoutSeconds: 10,
		input,
	});
}

function runCommand(
	bundle: TabBundle,
	stateDirectory: string,
	sessions: string,
	execution: {
		argv: string[];
		label: "Collector" | "Query";
		timeoutSeconds: number;
		input?: string;
	},
): CommandRun {
	const { label, timeoutSeconds } = execution;
	const [command, ...args] = execution.argv;
	if (!command) throw new CommandError(`${label} command is missing`);
	const child = spawn(command, args, {
		cwd: bundle.root,
		shell: false,
		detached: true,
		stdio: [execution.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		env: {
			...process.env,
			OBSERVATORY_SESSIONS_DIR: sessions,
			OBSERVATORY_STATE_DIR: stateDirectory,
			OBSERVATORY_TAB_ID: bundle.manifest.id,
		},
	});
	let failure: string | null = null;
	let failureReason: "timeout" | "failure" = "failure";
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
				failure ??= `Could not stop ${label.toLowerCase()} process group: ${String(error)}`;
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
			child.stdin?.destroy();
			child.stdout?.destroy();
			child.stderr?.destroy();
		}, TERMINATION_GRACE_MS);
	};
	const timeout = setTimeout(() => {
		if (!failure) failureReason = "timeout";
		terminate(
			`${label} timed out after ${timeoutSeconds}s. ${label === "Collector" ? "Finish sooner or increase timeoutSeconds (maximum 300)." : "Make the query finish sooner."}`,
		);
	}, timeoutSeconds * 1000);

	const result = new Promise<{ data: unknown; json: string }>(
		(resolve, reject) => {
			child.stdout?.on("data", (chunk: Buffer) => {
				stdoutBytes += chunk.length;
				if (stdoutBytes > MAX_SNAPSHOT_BYTES)
					terminate(
						`${label} stdout exceeded 4 MiB. Emit a smaller JSON ${label === "Collector" ? "snapshot" : "response"}.`,
					);
				else if (!failure) stdout.push(chunk);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderrBytes += chunk.length;
				if (stderrBytes > MAX_STDERR_BYTES)
					terminate(
						`${label} stderr exceeded 64 KiB. Reduce ${label.toLowerCase()} logging.`,
					);
				else stderr.push(chunk);
			});
			child.stdout?.on("error", (error) =>
				terminate(
					`Could not read ${label.toLowerCase()} stdout: ${error.message}`,
				),
			);
			child.stderr?.on("error", (error) =>
				terminate(
					`Could not read ${label.toLowerCase()} stderr: ${error.message}`,
				),
			);
			child.stdin?.on("error", (error) =>
				terminate(
					`Could not send ${label.toLowerCase()} input: ${error.message}`,
				),
			);
			child.on("error", (error) => {
				failure ??= `Could not start ${label.toLowerCase()} ${command}: ${error.message}. Check the command and executable permissions.`;
			});
			child.once("close", (code, signal) => {
				finished = true;
				clearTimeout(timeout);
				clearTimeout(killTimer);
				// Foreground collectors may not leave background children behind.
				signalGroup("SIGKILL");
				child.stdin?.destroy();
				child.stdout?.destroy();
				child.stderr?.destroy();
				if (code !== 0)
					failure ??= `${label} exited ${signal ? `with signal ${signal}` : `with code ${code}`}. Fix the ${label.toLowerCase()} command.`;
				if (failure) {
					const logs = Buffer.concat(stderr)
						.toString("utf8")
						.trim()
						.slice(-2048);
					reject(
						new CommandError(
							`${failure}${logs ? ` Stderr: ${logs}` : ""}`,
							failureReason,
						),
					);
					return;
				}
				try {
					const json = new TextDecoder("utf-8", { fatal: true }).decode(
						Buffer.concat(stdout),
					);
					resolve({ data: JSON.parse(json), json });
				} catch {
					reject(
						new CommandError(
							`${label} stdout must contain exactly one JSON value. Send logs to stderr.`,
						),
					);
				}
			});
		},
	);
	if (execution.input !== undefined) child.stdin?.end(execution.input);
	return {
		result,
		stop: (reason) =>
			terminate(reason ?? `${label} stopped because Observatory is closing.`),
	};
}
