import type {
	EntryRenderer,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	APPLY_PATCH_DISPLAY_AVAILABLE_CHANNEL,
	APPLY_PATCH_DISPLAY_PROTOCOL,
	APPLY_PATCH_DISPLAY_REQUEST_CHANNEL,
	type ApplyPatchDisplayBroker,
	isApplyPatchDisplayBroker,
} from "./tools/apply-patch/display-protocol.js";
import type { ApplyPatchToolDetails } from "./tools/apply-patch/render-state.js";

export interface ApplyPatchDisplayData {
	toolCallId: string;
	input: string;
	details?: ApplyPatchToolDetails | undefined;
	content?: string | undefined;
	error?: string | undefined;
	isError: boolean;
	source: "direct" | "nested";
}

export interface ApplyPatchDisplayOptions {
	customType: string;
	render: EntryRenderer<ApplyPatchDisplayData>;
}

export interface ApplyPatchDisplayRegistration {
	readonly available: boolean;
	dispose(): void;
}

export function registerApplyPatchDisplay(
	pi: ExtensionAPI,
	options: ApplyPatchDisplayOptions,
): ApplyPatchDisplayRegistration {
	const customType = options.customType.trim();
	if (!customType)
		throw new Error("apply_patch display customType cannot be empty");
	pi.registerEntryRenderer(customType, options.render);

	let broker: ApplyPatchDisplayBroker | undefined;
	let unregisterDisplay: (() => void) | undefined;
	let disposed = false;
	const unregisterAvailable = pi.events.on(
		APPLY_PATCH_DISPLAY_AVAILABLE_CHANNEL,
		(value) => {
			if (disposed || !isApplyPatchDisplayBroker(value) || value === broker)
				return;
			unregisterDisplay?.();
			broker = value;
			unregisterDisplay = value.register(customType);
		},
	);
	const registration: ApplyPatchDisplayRegistration = {
		get available() {
			return !disposed && (broker?.isActive() ?? false);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unregisterAvailable();
			unregisterDisplay?.();
			unregisterDisplay = undefined;
			broker = undefined;
		},
	};
	pi.on("session_shutdown", () => registration.dispose());
	pi.events.emit(APPLY_PATCH_DISPLAY_REQUEST_CHANNEL, {
		protocol: APPLY_PATCH_DISPLAY_PROTOCOL,
	});
	return registration;
}
