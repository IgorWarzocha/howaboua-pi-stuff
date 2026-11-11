import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { compile, obj, oneOf, type Static } from "@earendil-works/pi-schema";

const settingsSchema = obj(
	{
		access: { ...oneOf(["codex", "openai"]), type: "string" },
		api: obj(
			{
				model: {
					...oneOf(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]),
					type: "string",
				},
				quality: {
					...oneOf(["auto", "low", "medium", "high", "xhigh", "max"]),
					type: "string",
				},
				complexity: { ...oneOf(["low", "medium", "high"]), type: "string" },
			},
			{ open: false },
		),
	},
	{ open: false },
);
const settingsValidator = compile(settingsSchema);

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
	if (!settingsValidator.check(value))
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
