import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ToolExecutionContext } from "./types.js";

const PREFLIGHT_PROTOCOL = "@howaboua/pi-codex-conversion/code-mode-preflight/v1";
const PREFLIGHT_REQUEST_CHANNEL = `${PREFLIGHT_PROTOCOL}/request`;
const PREFLIGHT_AVAILABLE_CHANNEL = `${PREFLIGHT_PROTOCOL}/available`;

export interface CodeModeToolPreflightCall {
	toolName: string;
	input: unknown;
	toolCallId: string;
	cwd: string;
	extensionContext: ExtensionContext;
	signal: AbortSignal;
}

export type CodeModeToolPreflightResult =
	| { block: true; reason: string }
	| { block?: false };

export type CodeModeToolPreflight = (
	call: CodeModeToolPreflightCall,
) =>
	| CodeModeToolPreflightResult
	| void
	| Promise<CodeModeToolPreflightResult | void>;

export interface CodeModeToolPreflightRegistration {
	readonly available: boolean;
	dispose(): void;
}

export type CodeModeToolPreflightRunner = (
	call: CodeModeToolPreflightCall,
) => Promise<void>;

interface PreflightBroker {
	protocol: typeof PREFLIGHT_PROTOCOL;
	isActive(): boolean;
	register(preflight: CodeModeToolPreflight): () => void;
}

interface BrokerRegistration {
	run: CodeModeToolPreflightRunner;
}

export function registerCodeModeToolPreflight(
	pi: ExtensionAPI,
	preflight: CodeModeToolPreflight,
): CodeModeToolPreflightRegistration {
	let broker: PreflightBroker | undefined;
	let unregisterPreflight: (() => void) | undefined;
	let disposed = false;
	const unregisterAvailable = pi.events.on(
		PREFLIGHT_AVAILABLE_CHANNEL,
		(value) => {
			if (disposed || !isPreflightBroker(value) || value === broker) return;
			unregisterPreflight?.();
			broker = value;
			unregisterPreflight = value.register(preflight);
		},
	);
	const registration: CodeModeToolPreflightRegistration = {
		get available() {
			return !disposed && (broker?.isActive() ?? false);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unregisterAvailable();
			unregisterPreflight?.();
			unregisterPreflight = undefined;
			broker = undefined;
		},
	};
	pi.on("session_shutdown", () => registration.dispose());
	pi.events.emit(PREFLIGHT_REQUEST_CHANNEL, { protocol: PREFLIGHT_PROTOCOL });
	return registration;
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
				const result = await preflight(call);
				if (result?.block !== true) continue;
				const reason = typeof result.reason === "string"
					? result.reason.trim()
					: "";
				throw new Error(
					reason || `Code Mode nested tool blocked: ${call.toolName}`,
				);
			}
		},
	};
}

export async function runCodeModeToolPreflight(
	toolName: string,
	input: unknown,
	context: ToolExecutionContext,
	signal: AbortSignal,
): Promise<void> {
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
}

function isProtocolRequest(value: unknown): boolean {
	return Boolean(
		value &&
			typeof value === "object" &&
			"protocol" in value &&
			value.protocol === PREFLIGHT_PROTOCOL,
	);
}

function isPreflightBroker(value: unknown): value is PreflightBroker {
	return Boolean(
		value &&
			typeof value === "object" &&
			"protocol" in value &&
			value.protocol === PREFLIGHT_PROTOCOL &&
			"isActive" in value &&
			typeof value.isActive === "function" &&
			"register" in value &&
			typeof value.register === "function",
	);
}
