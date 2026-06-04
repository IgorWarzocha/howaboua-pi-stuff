import type { AssistantMessage } from "@earendil-works/pi-ai";

export class NonRetryableProviderError extends Error {}

export function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

export function buildProviderErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/^(?:WebSocket (?:error|closed|connect timeout|idle timeout)|WebSocket stream closed before response\.completed|Stream closed before response\.completed)/.test(message)) {
		return `Connection error: ${message}`;
	}
	return message;
}

export function createErrorMessage(message: AssistantMessage, error: unknown, aborted: boolean): AssistantMessage {
	for (const block of message.content) {
		if (typeof block === "object" && block !== null && "partialJson" in block) {
			delete (block as { partialJson?: string | undefined }).partialJson;
		}
	}
	message.stopReason = aborted ? "aborted" : "error";
	message.errorMessage = buildProviderErrorMessage(error);
	return message;
}

export async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string | undefined }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;

	try {
		const parsed = JSON.parse(raw) as { error?: { code?: string | undefined; type?: string | undefined; plan_type?: string | undefined; resets_at?: number | undefined; message?: string | undefined } | undefined };
		const err = parsed?.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins = err.resets_at ? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000)) : undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {
		// ignore malformed error bodies
	}

	return { message, friendlyMessage };
}
