import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const settingsSchema = Type.Object(
	{
		access: Type.Enum(["codex", "openai"]),
		api: Type.Object(
			{
				model: Type.Enum(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]),
				quality: Type.Enum(["auto", "low", "medium", "high", "xhigh", "max"]),
				complexity: Type.Enum(["low", "medium", "high"]),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
export type ImagegenSettings = Static<typeof settingsSchema>;

function defaultImagegenSettings(): ImagegenSettings {
	return {
		access: "codex",
		api: { model: "gpt-image-2.6-flare", quality: "auto", complexity: "high" },
	};
}

function validateImagegenSettings(
	value: unknown,
): asserts value is ImagegenSettings {
	if (!Check(settingsSchema, value))
		throw new Error(
			"Invalid imagegen.json. Correct or remove it in Pi's agent directory, then reopen /imagegen.",
		);
}

function settingsPath(): string {
	return join(getAgentDir(), "imagegen.json");
}

export function readImagegenSettings(): ImagegenSettings {
	let text: string;
	try {
		text = readFileSync(settingsPath(), "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return defaultImagegenSettings();
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(
			"Could not read imagegen.json. Correct or remove it, then reopen /imagegen.",
		);
	}
	validateImagegenSettings(value);
	return value;
}

export function writeImagegenSettings(settings: ImagegenSettings): void {
	validateImagegenSettings(settings);
	mkdirSync(getAgentDir(), { recursive: true });
	writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n", {
		mode: 0o600,
	});
}
