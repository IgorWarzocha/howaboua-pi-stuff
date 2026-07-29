import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, parseKey, type KeyId } from "@earendil-works/pi-tui";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";

const INITIAL_RELEASE_FALLBACK_MS = 650;
const REPEAT_RELEASE_FALLBACK_MS = 120;

export interface CodexVoiceShortcutActions {
	startDictation(ctx: ExtensionContext): Promise<void>;
	finishDictation(ctx: ExtensionContext): Promise<void>;
	toggleDictation(ctx: ExtensionContext): Promise<void>;
	toggleRealtime(ctx: ExtensionContext): Promise<void>;
	toggleInputMute(ctx: ExtensionContext): void;
	toggleServer(ctx: ExtensionContext): Promise<void>;
}

export function registerCodexVoiceShortcuts(
	pi: ExtensionAPI,
	initialConfig: CodexConversionConfig,
	getConfig: () => CodexConversionConfig,
	actions: CodexVoiceShortcutActions,
): void {
	const dictationShortcut = initialConfig.voice.dictationShortcut as KeyId;
	const realtimeShortcut = initialConfig.voice.realtimeShortcut as KeyId;
	const muteShortcut = initialConfig.voice.muteShortcut as KeyId;
	const serverShortcut = initialConfig.voice.serverShortcut as KeyId;
	let operation = Promise.resolve();
	let removeTerminalInput: (() => void) | undefined;
	let dictationKeyDown: string | undefined;
	let releaseFallbackTimer: ReturnType<typeof setTimeout> | undefined;

	const enqueue = (ctx: ExtensionContext, action: () => Promise<void>): Promise<void> => {
		const next = operation.then(action, action);
		operation = next.catch((error: unknown) => {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		});
		return operation;
	};
	const clearReleaseFallback = (): void => {
		if (releaseFallbackTimer) clearTimeout(releaseFallbackTimer);
		releaseFallbackTimer = undefined;
	};
	const finishPushDictation = (ctx: ExtensionContext): void => {
		if (!dictationKeyDown) return;
		dictationKeyDown = undefined;
		clearReleaseFallback();
		void enqueue(ctx, () => actions.finishDictation(ctx));
	};
	const armReleaseFallback = (ctx: ExtensionContext, delay: number): void => {
		clearReleaseFallback();
		releaseFallbackTimer = setTimeout(() => finishPushDictation(ctx), delay);
	};

	pi.registerShortcut(dictationShortcut, {
		description: "Codex push-to-dictate",
		handler: (ctx) => enqueue(ctx, async () => {
			const mode = getConfig().voice.dictationShortcutMode;
			if (mode === "toggle") {
				dictationKeyDown = undefined;
				clearReleaseFallback();
				await actions.toggleDictation(ctx);
			} else {
				dictationKeyDown = keyIdentity(dictationShortcut);
				armReleaseFallback(ctx, INITIAL_RELEASE_FALLBACK_MS);
				await actions.startDictation(ctx);
			}
		}),
	});

	pi.registerShortcut(realtimeShortcut, {
		description: "Toggle Codex realtime voice",
		handler: (ctx) => enqueue(ctx, () => actions.toggleRealtime(ctx)),
	});
	pi.registerShortcut(muteShortcut, {
		description: "Toggle Codex realtime microphone mute",
		handler: (ctx) => enqueue(ctx, async () => actions.toggleInputMute(ctx)),
	});
	pi.registerShortcut(serverShortcut, {
		description: "Toggle Codex LAN voice server",
		handler: (ctx) => enqueue(ctx, () => actions.toggleServer(ctx)),
	});

	pi.on("session_start", (_event, ctx) => {
		removeTerminalInput?.();
		dictationKeyDown = undefined;
		clearReleaseFallback();
		removeTerminalInput = ctx.ui.onTerminalInput((data) => {
			if ((matchesKey(data, realtimeShortcut) || matchesKey(data, muteShortcut) || matchesKey(data, serverShortcut)) && isKeyRepeat(data)) return { consume: true };
			const mode = getConfig().voice.dictationShortcutMode;
			if (mode !== "push") {
				dictationKeyDown = undefined;
				clearReleaseFallback();
			}
			if (mode === "push" && dictationKeyDown && keyIdentity(parseKey(data)) === dictationKeyDown) {
				if (isKeyRelease(data)) finishPushDictation(ctx);
				else if (matchesKey(data, dictationShortcut)) armReleaseFallback(ctx, REPEAT_RELEASE_FALLBACK_MS);
				return { consume: true };
			}
			if (!matchesKey(data, dictationShortcut)) return undefined;
			if (isKeyRepeat(data) || isKeyRelease(data)) return { consume: true };
			return undefined;
		});
	});

	pi.on("session_shutdown", () => {
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		dictationKeyDown = undefined;
		clearReleaseFallback();
	});
}

function keyIdentity(key: string | undefined): string | undefined {
	return key?.replace(/^(?:(?:ctrl|shift|alt|super)\+)+/, "");
}
