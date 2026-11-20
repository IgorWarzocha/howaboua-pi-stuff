import {
	fetch as undiciFetch,
	FormData,
	ProxyAgent,
	type Response,
} from "undici";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { resolveWebSocketProxyForTarget } from "../../providers/openai-codex/websocket-connection.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import { MAX_REALTIME_SDP_BYTES } from "./peer.ts";

const V3_MODEL = "gpt-live-1.1-codex";
const API_LIVE_MODEL = "gpt-live-1.1";

type RealtimeCallResult = { status: number; answer: string };
export type RealtimeCallSetup = (
	endpoint: string,
	headers: Headers,
	signal: AbortSignal,
	body: string | FormData,
	env?: Record<string, string>,
) => Promise<RealtimeCallResult>;

export function buildRealtimeCallRequest(
	sdp: string,
	config: CodexConversionConfig,
	instructions: string,
	initialItems?: RealtimeInitialMessageItem[],
) {
	return {
		sdp,
		session: {
			model: V3_MODEL,
			instructions,
			audio: { output: { voice: config.voice.v3Voice } },
			delegation: {
				type: "client",
				ack_filler: config.voice.delegationAcknowledgements,
			},
			...(initialItems?.length ? { initial_items: initialItems } : {}),
		},
	};
}

export function buildApiLiveCallRequest(
	sdp: string,
	voice: string,
	instructions: string,
	initialItems?: RealtimeInitialMessageItem[],
) {
	return {
		session: {
			model: API_LIVE_MODEL,
			instructions,
			audio: { output: { voice } },
			delegation: { type: "client" },
			...(initialItems?.length ? { input: initialItems } : {}),
		},
		transport: { type: "webrtc", sdp },
	};
}

export function parseApiLiveAnswer(answer: string): string {
	let result: unknown;
	try {
		result = JSON.parse(answer);
	} catch {
		throw new Error(
			"Voice returned an invalid session response. Start voice again.",
		);
	}
	if (
		!result ||
		typeof result !== "object" ||
		!("transport" in result) ||
		!result.transport ||
		typeof result.transport !== "object" ||
		!("sdp" in result.transport) ||
		typeof result.transport.sdp !== "string" ||
		!result.transport.sdp.trim() ||
		Buffer.byteLength(result.transport.sdp) > MAX_REALTIME_SDP_BYTES
	)
		throw new Error(
			"Voice returned an invalid session response. Start voice again.",
		);
	return result.transport.sdp;
}

export const setupRealtimeCall: RealtimeCallSetup = async (
	endpoint,
	headers,
	signal,
	body,
	env,
) => {
	const proxy = await resolveWebSocketProxyForTarget(endpoint, env);
	const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
	try {
		const response = await undiciFetch(endpoint, {
			method: "POST",
			headers: Object.fromEntries(headers),
			signal,
			body,
			...(dispatcher ? { dispatcher } : {}),
		});
		return {
			status: response.status,
			answer: await readBoundedResponseText(response, MAX_REALTIME_SDP_BYTES),
		};
	} finally {
		await dispatcher?.close();
	}
};

async function readBoundedResponseText(
	response: Response,
	maxBytes: number,
): Promise<string> {
	const declaredBytes = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes)
		throw new Error(`Codex voice response exceeded ${maxBytes} bytes`);
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			bytes += chunk.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(`Codex voice response exceeded ${maxBytes} bytes`);
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, bytes).toString("utf8");
}
