export const CODEX_TURN_STATE_HEADER = "x-codex-turn-state";
export function createCodexTurnState() {
    let value;
    let prewarmed = false;
    const capture = (next) => {
        if (value !== undefined || !next?.trim())
            return;
        value = next.trim();
    };
    return {
        current: () => value,
        capture,
        capturePrewarm(next) {
            capture(next);
            if (value !== undefined)
                prewarmed = true;
        },
        beginTurn() {
            if (prewarmed) {
                prewarmed = false;
                return;
            }
            value = undefined;
        },
        reset() {
            value = undefined;
            prewarmed = false;
        },
    };
}
export function extractCodexTurnStateFromWebSocketEvent(event) {
    if (!event || typeof event !== "object")
        return undefined;
    const type = event.type;
    if (type !== "response.metadata" && type !== "codex.response.metadata")
        return undefined;
    const headers = event.headers;
    if (!headers || typeof headers !== "object" || Array.isArray(headers))
        return undefined;
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === CODEX_TURN_STATE_HEADER && typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
