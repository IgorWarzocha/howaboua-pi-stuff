import { BrowserCdpSession } from "../cdp/session.js";
import { pruneArtifacts } from "./artifacts.js";
import { browserHelp } from "./help.js";
import type { BrowserOperation } from "./operation.js";
import { BrowserOperationExecutor } from "./operation-executor.js";
import { executeRemoteBrowser } from "./remote.js";
import type { BrowserRequest } from "./request.js";
import { BrowserRoutes, loadBrowserRoutes } from "./routes.js";

export interface BrowserExecutionOptions {
	signal?: AbortSignal | undefined;
	onOperation?(operation: BrowserOperation, index: number, total: number): void;
}

export class BrowserRuntime {
	readonly hosts: readonly string[];
	private readonly cdp = new BrowserCdpSession();
	private readonly operations = new BrowserOperationExecutor(this.cdp);
	private readonly routes: BrowserRoutes;

	constructor(routes = loadBrowserRoutes()) {
		this.routes = routes;
		this.hosts = routes.names;
	}

	async execute(
		request: BrowserRequest,
		options: BrowserExecutionOptions = {},
	): Promise<Record<string, unknown>> {
		options.signal?.throwIfAborted();
		await pruneArtifacts();
		if ("help" in request) return browserHelp(this.hosts);
		if (request.host) {
			const route = this.routes.resolve(request.host);
			if (!route.local) {
				const first = request.operations[0];
				if (first) {
					options.onOperation?.(first, 0, request.operations.length);
				}
				const result = await executeRemoteBrowser(
					route,
					request.operations,
					options.signal,
				);
				return { host: request.host, ...result };
			}
		}
		const result = await this.executeLocal(request.operations, options);
		return request.host ? { host: request.host, ...result } : result;
	}

	close(): void {
		this.cdp.close();
	}

	private async executeLocal(
		operations: BrowserOperation[],
		options: BrowserExecutionOptions,
	): Promise<Record<string, unknown>> {
		const results: Record<string, unknown>[] = [];
		for (const [index, operation] of operations.entries()) {
			try {
				options.signal?.throwIfAborted();
				options.onOperation?.(operation, index, operations.length);
				results.push(await this.operations.execute(operation, options.signal));
			} catch (error) {
				throw new Error(
					`batch failed at ${operation.action}[${index}] after ${results.length} completed operation(s): ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		const first = results[0];
		if (results.length === 1 && first) return first;
		return {
			results: results.map((result, index) => ({
				operation: operations[index]?.action ?? "unknown",
				index,
				...result,
			})),
		};
	}
}
