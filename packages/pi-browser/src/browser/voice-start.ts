import { sleep } from "../cdp/discovery.js";
import { asRecord, errorMessage } from "../cdp/types.js";
import { assertHttpUrl } from "../cdp/url.js";
import type { BrowserOperation } from "./operation.js";
import { BrowserRuntime } from "./runtime.js";

export interface BrowserVoiceStartOptions {
	url: string;
	host?: string;
	provider: "codex" | "gippity" | "grok";
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface BrowserVoiceStartResult {
	state: "listening" | "error" | "timeout";
	url: string;
	refId?: string;
	status: string;
	detail: string;
}

// Read the bundled frontends' acknowledged audio state, not socket connectivity
// or the fact that a click was dispatched. No permissions or trust are changed.
const CONVERSATION_STATE = String.raw`(() => {
	const button = document.querySelector('#voice');
	const status = document.querySelector('#audio-state')?.textContent?.trim() || '';
	const detail = document.querySelector('#audio-detail')?.textContent?.trim() || '';
	const listening = button?.dataset.mode === 'conversation' && button?.getAttribute('aria-pressed') === 'true' && status === 'Listening';
	const failed = ['Could not start', 'Voice disconnected', 'Could not reconnect', 'Moved to another device', 'Transferred session ended', 'Microphone muted'].includes(status);
	return {state: listening ? 'listening' : failed ? 'error' : button && !button.disabled && button.getAttribute('aria-busy') !== 'true' && button.getAttribute('aria-pressed') !== 'true' && button.dataset.mode === 'conversation' ? 'ready' : 'waiting', status, detail};
})()`;

const GROK_STATE = String.raw`(() => {
	const button = document.querySelector('#start');
	const status = document.querySelector('#status')?.textContent?.trim() || '';
	const detail = document.querySelector('#error')?.textContent?.trim() || '';
	const mode = document.querySelector('#mode')?.value;
	const muted = document.querySelector('#mute')?.getAttribute('aria-pressed') === 'true';
	const listening = !muted && mode === 'voice' && /^listening(?: ·|$)/.test(status) && status.includes(' · browser microphone connected');
	return {state: detail || muted ? 'error' : listening ? 'listening' : button && !button.disabled && mode === 'voice' ? 'ready' : 'waiting', status, detail: muted ? 'Microphone is muted. Unmute it in the voice page.' : detail};
})()`;

interface PageState {
	state: "listening" | "ready" | "waiting" | "error";
	status: string;
	detail: string;
}

function pageState(result: Record<string, unknown>): PageState {
	if (typeof result["value"] !== "string")
		throw new Error("Voice page did not return its audio status");
	const value = asRecord(JSON.parse(result["value"]), "Voice page status");
	const state = value["state"];
	if (
		(state !== "listening" &&
			state !== "ready" &&
			state !== "waiting" &&
			state !== "error") ||
		typeof value["status"] !== "string" ||
		typeof value["detail"] !== "string"
	)
		throw new Error("Voice page returned an invalid audio status");
	return { state, status: value["status"], detail: value["detail"] };
}

/** Start once in a new tab; disconnect automation without closing the tab. */
export async function startBrowserVoice(
	options: BrowserVoiceStartOptions,
): Promise<BrowserVoiceStartResult> {
	const timeoutMs = options.timeoutMs ?? 30_000;
	if (
		!Number.isInteger(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > 2_147_483_647
	)
		throw new Error(
			"Voice browser timeout must fit a positive signed 32-bit millisecond timer",
		);
	assertHttpUrl(options.url);
	if (!["codex", "gippity", "grok"].includes(options.provider))
		throw new Error("Unsupported voice page provider");
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeout])
		: timeout;
	let runtime: BrowserRuntime | undefined;
	let refId: string | undefined;
	let observed: PageState = { state: "waiting", status: "", detail: "" };
	let clicked = false;
	const result = (
		state: BrowserVoiceStartResult["state"],
		detail = observed.detail,
	): BrowserVoiceStartResult => ({
		state,
		url: options.url,
		...(refId ? { refId } : {}),
		status: observed.status,
		detail,
	});
	try {
		const browser = new BrowserRuntime();
		runtime = browser;
		const execute = (operation: BrowserOperation) =>
			browser.execute(
				{
					operations: [operation],
					...(options.host ? { host: options.host } : {}),
				},
				{ signal },
			);
		const opened = await execute({ action: "open", url: options.url });
		if (opened["owned"] !== true || typeof opened["ref_id"] !== "string")
			throw new Error("Browser did not confirm ownership of the new voice tab");
		refId = opened["ref_id"];
		await execute({
			action: "wait",
			ref_id: refId,
			selector: options.provider === "grok" ? "#start" : "#voice",
			timeout_ms: timeoutMs,
		});
		while (true) {
			signal.throwIfAborted();
			observed = pageState(
				await execute({
					action: "evaluate",
					ref_id: refId,
					expression:
						options.provider === "grok" ? GROK_STATE : CONVERSATION_STATE,
				}),
			);
			if (observed.state === "listening") return result("listening");
			if (observed.state === "error") return result("error");
			if (!clicked && observed.state === "ready") {
				// Never retry a possibly dispatched start: it may toggle an active call.
				clicked = true;
				await execute({
					action: "click",
					ref_id: refId,
					selector: options.provider === "grok" ? "#start" : "#voice",
				});
			}
			await sleep(200, signal);
		}
	} catch (error) {
		return result(
			timeout.aborted && !options.signal?.aborted ? "timeout" : "error",
			`${errorMessage(error)}${observed.detail ? ` · ${observed.detail}` : ""}`,
		);
	} finally {
		// Disconnect automation only; the page owns the continuing microphone.
		await runtime?.close();
	}
}
