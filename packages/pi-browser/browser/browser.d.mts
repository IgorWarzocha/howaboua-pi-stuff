export interface BrowserOperation {
	action: string;
	[key: string]: unknown;
}

export type BrowserRequest =
	| { help: true }
	| {
			operations: BrowserOperation[];
			host?: string;
	  };

export interface BrowserExecutionOptions {
	signal?: AbortSignal;
	onOperation?(
		operation: BrowserOperation,
		index: number,
		total: number,
	): void;
}

export function parseRequest(input: unknown): BrowserRequest;
export function executeBrowserRequest(
	request: BrowserRequest,
	options?: BrowserExecutionOptions,
): Promise<Record<string, unknown>>;
