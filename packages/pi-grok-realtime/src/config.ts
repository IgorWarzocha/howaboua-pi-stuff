import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

// GrokBot ships these IDs; availability on a particular account is not guaranteed.
export const VOICES = [
	"altair",
	"ara",
	"atlas",
	"aurora",
	"carina",
	"castor",
	"celeste",
	"cosmo",
	"eve",
	"helios",
	"helix",
	"iris",
	"kepler",
	"leo",
	"liora",
	"lumen",
	"luna",
	"lux",
	"naksh",
	"orion",
	"perseus",
	"rex",
	"rigel",
	"sal",
	"sirius",
	"ursa",
	"zagan",
	"zenith",
] as const;
// Public realtime alias and its current target; account entitlement may differ.
export const MODELS = [
	"grok-voice-latest",
	"grok-voice-think-fast-2.0",
] as const;
// GrokBot's speed chooser; presets are suggestions, not client-enforced limits.
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const CONTEXT_REASONING = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;
export interface GrokRealtimeConfig {
	access: "oauth" | "api_key";
	voice: string;
	model: string;
	port: number;
	speed: number;
	silenceSeconds: number;
	language: string;
	reasoning: "high" | "none";
	webSearch: boolean;
	autoResume: boolean;
	microphone: string;
	speaker: string;
	voiceShortcut: KeyId | "";
	dictationShortcut: KeyId | "";
	contextModel: string;
	contextReasoning: (typeof CONTEXT_REASONING)[number];
}
const DEFAULT_CONFIG: GrokRealtimeConfig = {
	access: "oauth",
	voice: "eve",
	model: "grok-voice-latest",
	port: 43121,
	speed: 1,
	silenceSeconds: 0,
	language: "auto",
	reasoning: "high",
	webSearch: false,
	autoResume: true,
	microphone: "",
	speaker: "",
	voiceShortcut: "ctrl+alt+v",
	dictationShortcut: "ctrl+alt+t",
	contextModel: "current",
	contextReasoning: "high",
};
const configPath = () => join(getAgentDir(), "grok-realtime.json");

/** Apply a partial settings patch without resetting omitted fields. */
export function normalizeConfig(
	value: unknown,
	base: GrokRealtimeConfig = DEFAULT_CONFIG,
): GrokRealtimeConfig {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid Grok realtime settings");
	const result = { ...base };
	for (const [key, supplied] of Object.entries(value)) {
		switch (key) {
			case "webSearch":
			case "autoResume":
				if (typeof supplied !== "boolean")
					throw new Error(`${key} must be a boolean`);
				result[key] = supplied;
				break;
			case "microphone":
			case "speaker":
				if (typeof supplied !== "string" || supplied.includes("\0"))
					throw new Error(
						`${key} must be a device name or empty for system default`,
					);
				result[key] = supplied.trim();
				break;
			case "voiceShortcut":
			case "dictationShortcut":
				if (typeof supplied !== "string")
					throw new Error(`${key} must be a shortcut or empty to disable`);
				result[key] = normalizeShortcut(supplied);
				break;
			case "contextModel": {
				if (typeof supplied !== "string")
					throw new Error(
						"Context model must be current, off, or provider/modelId",
					);
				const model = supplied.trim();
				const slash = model.indexOf("/");
				if (
					model !== "current" &&
					model !== "off" &&
					(slash <= 0 ||
						!model.slice(0, slash).trim() ||
						!model.slice(slash + 1).trim())
				)
					throw new Error(
						"Context model must be current, off, or provider/modelId",
					);
				result.contextModel = model;
				break;
			}
			case "contextReasoning":
				if (!CONTEXT_REASONING.some((level) => level === supplied))
					throw new Error(
						"Context reasoning must be off, minimal, low, medium, high, or xhigh",
					);
				result.contextReasoning =
					supplied as GrokRealtimeConfig["contextReasoning"];
				break;
			case "access":
				if (supplied !== "oauth" && supplied !== "api_key")
					throw new Error("Access must be oauth or api_key");
				result.access = supplied;
				break;
			case "reasoning":
				if (supplied !== "high" && supplied !== "none")
					throw new Error("Reasoning must be high or none");
				result.reasoning = supplied;
				break;
			case "voice":
			case "model":
				if (typeof supplied !== "string" || !supplied.trim())
					throw new Error(`${key} must be a nonempty ID`);
				result[key] = supplied.trim();
				break;
			case "port":
				if (
					typeof supplied !== "number" ||
					!Number.isInteger(supplied) ||
					supplied < 1 ||
					supplied > 65535
				)
					throw new Error("Port must be an integer from 1 to 65535");
				result.port = supplied;
				break;
			case "speed":
				if (
					typeof supplied !== "number" ||
					!Number.isFinite(supplied) ||
					supplied <= 0
				)
					throw new Error("Speed must be a positive finite number");
				result.speed = supplied;
				break;
			case "silenceSeconds":
				if (
					typeof supplied !== "number" ||
					!Number.isFinite(supplied * 1000) ||
					supplied < 0
				)
					throw new Error(
						"Follow-up silence must be a nonnegative duration in seconds; 0 turns it off",
					);
				result.silenceSeconds = supplied;
				break;
			case "language":
				if (typeof supplied !== "string" || !supplied.trim())
					throw new Error("Language must be auto or a nonempty language tag");
				result.language = supplied.trim();
				break;
			default:
				throw new Error(`Unknown Grok realtime setting: ${key}`);
		}
	}
	if (result.voiceShortcut && result.voiceShortcut === result.dictationShortcut)
		throw new Error("Voice and dictation shortcuts must differ");
	return result;
}

function normalizeShortcut(value: string): KeyId | "" {
	const shortcut = value.trim();
	if (!shortcut) return "";
	const parts = shortcut.split("+");
	let key = parts.pop()!;
	if (key === "" && parts.at(-1) === "") {
		parts.pop();
		key = "+";
	}
	const modifiers = ["ctrl", "shift", "alt", "super"];
	const special = [
		"escape",
		"esc",
		"enter",
		"return",
		"tab",
		"space",
		"backspace",
		"delete",
		"insert",
		"clear",
		"home",
		"end",
		"pageUp",
		"pageDown",
		"up",
		"down",
		"left",
		"right",
	];
	if (
		parts.some((part) => !modifiers.includes(part)) ||
		new Set(parts).size !== parts.length ||
		!(
			/^[a-z0-9`\-=\[\]\\;\',./!@#$%^&*()_+|~{}:"<>?]$/.test(key) ||
			special.includes(key) ||
			/^f([1-9]|1[0-2])$/.test(key)
		)
	)
		throw new Error(
			"Use a Pi shortcut such as ctrl+shift+v, or empty to disable",
		);
	return [
		...modifiers.filter((modifier) => parts.includes(modifier)),
		key === "esc" ? "escape" : key === "return" ? "enter" : key,
	].join("+") as KeyId;
}

export function readConfig(): GrokRealtimeConfig {
	try {
		const value: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
		return normalizeConfig(value);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return { ...DEFAULT_CONFIG };
		throw new Error(
			"Could not read grok-realtime.json; correct its JSON and setting values before starting voice",
			{ cause: error },
		);
	}
}

export function writeConfig(config: GrokRealtimeConfig): void {
	const validated = normalizeConfig(config);
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
