type DictationShortcutMode = "push" | "toggle";

export const REALTIME_V3_VOICES = [
	"juniper",
	"maple",
	"spruce",
	"ember",
	"vale",
	"breeze",
	"arbor",
	"sol",
	"cove",
] as const;
export type RealtimeV3Voice = (typeof REALTIME_V3_VOICES)[number];

export interface GippityControlConfig {
	voice: {
		v3Voice: RealtimeV3Voice;
		dictationShortcut: string;
		realtimeShortcut: string;
		muteShortcut: string;
		serverShortcut: string;
		dictationShortcutMode: DictationShortcutMode;
		inputDevice?: string | undefined;
		outputDevice?: string | undefined;
	};
}

export const DEFAULT_GIPPITY_CONTROL_CONFIG: GippityControlConfig = {
	voice: {
		v3Voice: "cove",
		dictationShortcut: "ctrl+alt+d",
		realtimeShortcut: "ctrl+alt+space",
		muteShortcut: "ctrl+alt+m",
		serverShortcut: "ctrl+alt+g",
		dictationShortcutMode: "push",
	},
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && Buffer.byteLength(normalized) <= 512
		? normalized
		: undefined;
}

export function normalizeRealtimeV3Voice(
	value: unknown,
): RealtimeV3Voice | undefined {
	return typeof value === "string"
		? REALTIME_V3_VOICES.find((voice) => voice === value)
		: undefined;
}

export function normalizeGippityControlConfig(
	value: unknown,
): GippityControlConfig {
	if (!isObject(value)) return structuredClone(DEFAULT_GIPPITY_CONTROL_CONFIG);
	const voice = isObject(value["voice"]) ? value["voice"] : {};
	const inputDevice = optionalString(voice["inputDevice"]);
	const outputDevice = optionalString(voice["outputDevice"]);
	return {
		voice: {
			v3Voice:
				normalizeRealtimeV3Voice(voice["v3Voice"]) ??
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.v3Voice,
			dictationShortcut: stringValue(
				voice["dictationShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.dictationShortcut,
			),
			realtimeShortcut: stringValue(
				voice["realtimeShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.realtimeShortcut,
			),
			muteShortcut: stringValue(
				voice["muteShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.muteShortcut,
			),
			serverShortcut: stringValue(
				voice["serverShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.serverShortcut,
			),
			dictationShortcutMode:
				voice["dictationShortcutMode"] === "toggle"
					? "toggle"
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.dictationShortcutMode,
			...(inputDevice ? { inputDevice } : {}),
			...(outputDevice ? { outputDevice } : {}),
		},
	};
}
