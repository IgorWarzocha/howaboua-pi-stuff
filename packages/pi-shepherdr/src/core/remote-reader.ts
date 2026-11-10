import type { AssistantReader } from "../session-reader.js";
import type { SessionView } from "../types.js";
import { object } from "./protocol.js";
import type { RemoteCoreEndpoint } from "./remote-endpoint.js";

export class CoreRemoteReader implements AssistantReader {
	private readonly endpoint: RemoteCoreEndpoint;
	constructor(endpoint: RemoteCoreEndpoint) {
		this.endpoint = endpoint;
	}
	async view(path?: string): Promise<SessionView> {
		if (!path) return {};
		return object(
			await this.endpoint.call({ op: "view", path }),
		) as SessionView;
	}
	async latest(path?: string) {
		return (await this.view(path)).assistant;
	}
	watch(
		paths: string[],
		onChange: (path: string) => void,
		onError: (error: Error) => void,
		signal: AbortSignal,
	): Promise<() => void> {
		return this.endpoint.bridge.watch(paths, onChange, onError, signal);
	}
}
