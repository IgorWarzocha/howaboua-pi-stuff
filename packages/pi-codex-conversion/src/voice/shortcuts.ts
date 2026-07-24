import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, isKittyProtocolActive, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";

export interface CodexVoiceShortcutActions {
	startDictation(ctx: ExtensionContext): Promise<void>;
	finishDictation(ctx: ExtensionContext): Promise<void>;
	toggleDictation(ctx: ExtensionContext): Promise<void>;
	toggleRealtime(ctx: ExtensionContext): Promise<void>;
}

export function registerCodexVoiceShortcuts(
	pi: ExtensionAPI,
	initialConfig: CodexConversionConfig,
	getConfig: () => CodexConversionConfig,
	actions: CodexVoiceShortcutActions,
): void {
	const dictationShortcut = initialConfig.voice.dictationShortcut as KeyId;
	const realtimeShortcut = initialConfig.voice.realtimeShortcut as KeyId;
	let operation = Promise.resolve();
	let removeTerminalInput: (() => void) | undefined;
	let warnedUnsupportedPush = false;

	const enqueue = (ctx: ExtensionContext, action: () => Promise<void>): Promise<void> => {
		const next = operation.then(action, action);
		operation = next.catch((error: unknown) => {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		});
		return operation;
	};

	pi.registerShortcut(dictationShortcut, {
		description: "Codex push-to-dictate",
		handler: (ctx) => enqueue(ctx, async () => {
			const mode = getConfig().voice.dictationShortcutMode;
			if (mode === "push" && !isKittyProtocolActive()) {
				if (!warnedUnsupportedPush) {
					warnedUnsupportedPush = true;
					ctx.ui.notify("Push-to-dictate needs terminal key-release support. Set Dictation key behavior to toggle in /codex voice.", "warning");
				}
				return;
			}
			if (mode === "toggle") await actions.toggleDictation(ctx);
			else await actions.startDictation(ctx);
		}),
	});

	pi.registerShortcut(realtimeShortcut, {
		description: "Toggle Codex realtime voice",
		handler: (ctx) => enqueue(ctx, () => actions.toggleRealtime(ctx)),
	});

	pi.on("session_start", (_event, ctx) => {
		removeTerminalInput?.();
		removeTerminalInput = ctx.ui.onTerminalInput((data) => {
			if (matchesKey(data, realtimeShortcut) && isKeyRepeat(data)) return { consume: true };
			if (!matchesKey(data, dictationShortcut)) return undefined;
			if (isKeyRepeat(data)) return { consume: true };
			if (!isKeyRelease(data)) return undefined;
			if (getConfig().voice.dictationShortcutMode === "push") {
				void enqueue(ctx, () => actions.finishDictation(ctx));
			}
			return { consume: true };
		});
	});
}
