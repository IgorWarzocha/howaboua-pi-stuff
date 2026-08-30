export type CdpParams = Record<string, unknown>;

export interface CdpEventWait {
	promise: Promise<unknown>;
	cancel(): void;
}

export interface CdpConnection {
	send(
		method: string,
		params?: CdpParams,
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<unknown>;
	onEvent(method: string, handler: (params: unknown) => void): () => void;
	waitForEvent(
		method: string,
		timeout?: number,
		signal?: AbortSignal,
	): CdpEventWait;
}

export interface PageInfo {
	targetId: string;
	title: string;
	url: string;
	type?: string;
}

export type ElementRefs = Map<number, number>;

export function asRecord(
	value: unknown,
	label = "CDP response",
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} is not an object`);
	}
	return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} is not a string`);
	return value;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
