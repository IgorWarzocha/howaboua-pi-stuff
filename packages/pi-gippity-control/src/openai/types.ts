export interface WebSocketLike {
	readyState?: number | undefined;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface WebSocketConstructorLike {
	new (
		url: string,
		options?:
			| { headers?: Record<string, string> | undefined }
			| string
			| string[],
	): WebSocketLike;
}

export type ProviderEnv = Record<string, string>;
