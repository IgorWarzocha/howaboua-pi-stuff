import type { AssistantReader } from "../session-reader.js";
import type { SessionView } from "../types.js";
import { object } from "./protocol.js";
import type { RemoteCoreEndpoint } from "./remote-endpoint.js";
import { remoteExec } from "./remote-exec.js";

export class CoreRemoteReader implements AssistantReader {
	private readonly endpoint: RemoteCoreEndpoint;
	constructor(endpoint: RemoteCoreEndpoint) {
		this.endpoint = endpoint;
	}
	async view(path?: string): Promise<SessionView> {
		if (!path) return {};
		return object(
			await remoteExec(this.endpoint.host, this.endpoint.machine, {
				op: "view",
				path,
			}),
		) as SessionView;
	}
	async latest(path?: string) {
		return (await this.view(path)).assistant;
	}
	async watch(
		paths: string[],
		onChange: (path: string) => void,
		onError: (error: Error) => void,
		signal: AbortSignal,
	): Promise<() => void> {
		const lifetime = new AbortController();
		const abort = () => lifetime.abort();
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		const close = () => {
			signal.removeEventListener("abort", abort);
			lifetime.abort();
		};
		void (async () => {
			try {
				while (!lifetime.signal.aborted) {
					const changed = await remoteExec(
						this.endpoint.host,
						this.endpoint.machine,
						{ op: "watch", paths },
						{ signal: lifetime.signal },
					);
					if (lifetime.signal.aborted) break;
					if (
						!Array.isArray(changed) ||
						!changed.every(
							(path) => typeof path === "string" && paths.includes(path),
						)
					)
						throw new Error("Remote session watch returned invalid paths");
					// A bounded long-poll cannot promise continuity between processes.
					for (const path of changed.length ? changed : paths) onChange(path);
				}
			} catch (error) {
				if (!lifetime.signal.aborted)
					onError(error instanceof Error ? error : new Error(String(error)));
			} finally {
				close();
			}
		})();
		return close;
	}
}
