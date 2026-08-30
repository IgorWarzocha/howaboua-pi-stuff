import { BrowserCdpSession } from "../cdp/session.js";
import { pruneArtifacts } from "./artifacts.js";
import { browserHelp } from "./help.js";
import type { BrowserOperation } from "./operation.js";
import { BrowserOperationExecutor } from "./operation-executor.js";
import type { BrowserRequest } from "./request.js";

export interface BrowserExecutionOptions {
	signal?: AbortSignal | undefined;
	onOperation?(operation: BrowserOperation, index: number, total: number): void;
}

export class BrowserRuntime {
	private readonly cdp = new BrowserCdpSession();
	private readonly operations = new BrowserOperationExecutor(this.cdp);

	async execute(
		request: BrowserRequest,
		options: BrowserExecutionOptions = {},
	): Promise<Record<string, unknown>> {
		options.signal?.throwIfAborted();
		await pruneArtifacts();
		if ("help" in request) return browserHelp();
		const results: Record<string, unknown>[] = [];
		for (const [index, operation] of request.operations.entries()) {
			try {
				options.signal?.throwIfAborted();
				options.onOperation?.(operation, index, request.operations.length);
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
				operation: request.operations[index]?.action ?? "unknown",
				index,
				...result,
			})),
		};
	}

	close(): void {
		this.cdp.close();
	}
}
