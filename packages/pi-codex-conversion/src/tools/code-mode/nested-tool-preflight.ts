import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type CodeModeToolPreflight,
	type CodeModeToolPreflightCall,
	isProtocolRequest,
	PREFLIGHT_AVAILABLE_CHANNEL,
	PREFLIGHT_PROTOCOL,
	PREFLIGHT_REQUEST_CHANNEL,
	type PreflightBroker,
} from "./preflight-protocol.js";
import type { ToolExecutionContext } from "./types.js";

export type CodeModeToolPreflightRunner = (
	call: CodeModeToolPreflightCall,
) => Promise<void>;

interface BrokerRegistration {
	run: CodeModeToolPreflightRunner;
}

export function registerCodeModePreflightBroker(
	pi: ExtensionAPI,
): BrokerRegistration {
	const preflights = new Set<CodeModeToolPreflight>();
	let active = true;
	const broker: PreflightBroker = {
		protocol: PREFLIGHT_PROTOCOL,
		isActive: () => active,
		register(preflight) {
			if (!active) return () => {};
			preflights.add(preflight);
			return () => preflights.delete(preflight);
		},
	};
	const announce = () => {
		if (active) pi.events.emit(PREFLIGHT_AVAILABLE_CHANNEL, broker);
	};
	pi.events.on(PREFLIGHT_REQUEST_CHANNEL, (value) => {
		if (isProtocolRequest(value)) announce();
	});
	pi.on("session_shutdown", () => {
		active = false;
		preflights.clear();
	});
	announce();
	return {
		async run(call) {
			for (const preflight of [...preflights]) {
				call.signal.throwIfAborted();
				const pending = Promise.resolve().then(() =>
					preflight(preflightSnapshot(call)),
				);
				void pending.catch(() => undefined);
				const result = await raceAbort(pending, call.signal);
				call.signal.throwIfAborted();
				if (result?.block !== true) continue;
				const reason =
					typeof result.reason === "string" ? result.reason.trim() : "";
				throw new Error(
					reason || `Code Mode nested tool blocked: ${call.toolName}`,
				);
			}
		},
	};
}

async function raceAbort<T>(
	pending: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	signal.throwIfAborted();
	let onAbort = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => {
			try {
				signal.throwIfAborted();
			} catch (error) {
				reject(error);
			}
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([pending, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

export async function runCodeModeToolPreflight(
	toolName: string,
	input: unknown,
	context: ToolExecutionContext,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	if (!context.preflight) return;
	if (!context.toolCallId || !context.extensionContext)
		throw new Error("Code Mode nested tool preflight context is unavailable");
	await context.preflight({
		toolName,
		input,
		toolCallId: context.toolCallId,
		cwd: context.cwd,
		extensionContext: context.extensionContext,
		signal,
	});
	signal.throwIfAborted();
}

function preflightSnapshot(
	call: CodeModeToolPreflightCall,
): CodeModeToolPreflightCall {
	return Object.freeze({
		...call,
		input: freezeInput(structuredClone(call.input)),
	});
}

function freezeInput(value: unknown): unknown {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	if (Array.isArray(value)) {
		for (const item of value) freezeInput(item);
	} else {
		for (const item of Object.values(value)) freezeInput(item);
	}
	return Object.freeze(value);
}
