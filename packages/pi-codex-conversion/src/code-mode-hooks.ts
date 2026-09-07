import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	PREFLIGHT_AVAILABLE_CHANNEL,
	PREFLIGHT_PROTOCOL,
	PREFLIGHT_REQUEST_CHANNEL,
	isPreflightBroker,
	type CodeModeToolCompletion,
	type PreflightBroker,
} from "./tools/code-mode/preflight-protocol.js";
export {
	registerCodeModeToolPreflight,
	type CodeModeToolPreflight,
	type CodeModeToolPreflightCall,
	type CodeModeToolPreflightResult,
	type CodeModeToolPreflightRegistration,
} from "./code-mode-preflight.js";
export type {
	CodeModeToolCompletion,
	CodeModeToolCompletionCall,
} from "./tools/code-mode/preflight-protocol.js";

export interface CodeModeToolCompletionRegistration {
	readonly available: boolean;
	dispose(): void;
}

export function registerCodeModeToolCompletion(
	pi: ExtensionAPI,
	completion: CodeModeToolCompletion,
): CodeModeToolCompletionRegistration {
	let broker: PreflightBroker | undefined;
	let unregister: (() => void) | undefined;
	let disposed = false;
	const stopDiscovery = pi.events.on(PREFLIGHT_AVAILABLE_CHANNEL, (value) => {
		if (disposed || !isPreflightBroker(value) || value === broker) return;
		unregister?.();
		broker = value;
		unregister = typeof value.registerCompletion === "function"
			? value.registerCompletion(completion)
			: undefined;
	});
	const registration: CodeModeToolCompletionRegistration = {
		get available() {
			return !disposed && !!unregister && (broker?.isActive() ?? false);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopDiscovery();
			unregister?.();
			unregister = undefined;
			broker = undefined;
		},
	};
	pi.on("session_shutdown", () => registration.dispose());
	pi.events.emit(PREFLIGHT_REQUEST_CHANNEL, { protocol: PREFLIGHT_PROTOCOL });
	return registration;
}
