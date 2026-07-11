export const CODEX_TURN_STATE_HEADER = "x-codex-turn-state";

export interface CodexTurnState {
	current(): string | undefined;
	capture(value: string | null | undefined): void;
	reset(): void;
}

export function createCodexTurnState(): CodexTurnState {
	let value: string | undefined;
	return {
		current: () => value,
		capture(next) {
			if (value !== undefined || !next?.trim()) return;
			value = next.trim();
		},
		reset() {
			value = undefined;
		},
	};
}

export function extractCodexTurnStateFromWebSocketEvent(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const type = (event as { type?: unknown }).type;
	if (type !== "response.metadata" && type !== "codex.response.metadata") return undefined;
	const headers = (event as { headers?: unknown }).headers;
	if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === CODEX_TURN_STATE_HEADER && typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}
