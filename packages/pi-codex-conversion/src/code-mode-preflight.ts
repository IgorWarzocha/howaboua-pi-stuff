import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	PREFLIGHT_AVAILABLE_CHANNEL,
	PREFLIGHT_PROTOCOL,
	PREFLIGHT_REQUEST_CHANNEL,
	isPreflightBroker,
	type CodeModeToolPreflight,
	type PreflightBroker,
} from "./tools/code-mode/preflight-protocol.js";

export type {
	CodeModeToolPreflight,
	CodeModeToolPreflightCall,
	CodeModeToolPreflightResult,
} from "./tools/code-mode/preflight-protocol.js";

export interface CodeModeToolPreflightRegistration {
	readonly available: boolean;
	dispose(): void;
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
