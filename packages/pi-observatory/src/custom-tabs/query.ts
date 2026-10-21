import type { TabBundle } from "./bundle.ts";
import { CommandError, type CommandRun, runQuery } from "./process.ts";

export class TabQueryError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Query processes read the bundle's own index; they never run collection. */
export class TabQueries {
	private readonly bundle: TabBundle;
	private readonly stateDirectory: string;
	private readonly sessions: string;
	private readonly active = new Set<CommandRun>();
	private closed = false;

	constructor(bundle: TabBundle, stateDirectory: string, sessions: string) {
		this.bundle = bundle;
		this.stateDirectory = stateDirectory;
		this.sessions = sessions;
	}

	async query(input: unknown, signal?: AbortSignal): Promise<unknown> {
		if (this.closed)
			throw new TabQueryError(
				503,
				"Observatory is closing. Retry after restarting.",
			);
		const argv = this.bundle.manifest.query;
		if (!argv)
			throw new TabQueryError(
				400,
				"This tab does not provide a query command.",
			);
		if (signal?.aborted)
			throw new TabQueryError(499, "Tab query was cancelled.");
		if (this.active.size >= 4)
			throw new TabQueryError(
				503,
				"This tab is busy with four queries. Retry shortly.",
			);
		let json: string | undefined;
		try {
			json = JSON.stringify(input);
		} catch {
			throw new TabQueryError(400, "Tab query input must be a JSON value.");
		}
		if (json === undefined)
			throw new TabQueryError(400, "Tab query input must be a JSON value.");
		const run = runQuery(
			this.bundle,
			this.stateDirectory,
			this.sessions,
			argv,
			json,
		);
		this.active.add(run);
		const abort = () => run.stop("Tab query was cancelled.");
		signal?.addEventListener("abort", abort, { once: true });
		try {
			return (await run.result).data;
		} catch (error) {
			if (signal?.aborted)
				throw new TabQueryError(499, "Tab query was cancelled.");
			if (this.closed)
				throw new TabQueryError(
					503,
					"Observatory is closing. Retry after restarting.",
				);
			throw new TabQueryError(
				error instanceof CommandError && error.reason === "timeout" ? 504 : 502,
				error instanceof Error
					? error.message
					: "Tab query failed. Check its command.",
			);
		} finally {
			signal?.removeEventListener("abort", abort);
			this.active.delete(run);
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		for (const run of this.active) run.stop();
		await Promise.allSettled([...this.active].map((run) => run.result));
	}
}
