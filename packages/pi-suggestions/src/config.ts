import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SuggestionConfig {
	enabled: boolean;
	model?: { provider: string; id: string; reasoning: ModelThinkingLevel };
}

const reasoningLevels = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ModelThinkingLevel[];

function validateConfig(value: unknown): SuggestionConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected a settings object.");
	}
	if (!("enabled" in value) || typeof value.enabled !== "boolean") {
		throw new Error('"enabled" must be true or false.');
	}
	if (Object.keys(value).some((key) => key !== "enabled" && key !== "model")) {
		throw new Error("Unknown settings field.");
	}
	if (!("model" in value)) {
		if (value.enabled)
			throw new Error("Enabled suggestions require a chosen model.");
		return { enabled: false };
	}
	const model = value.model;
	if (typeof model !== "object" || model === null || Array.isArray(model)) {
		throw new Error('"model" must contain provider, id and reasoning.');
	}
	if (
		!("provider" in model) ||
		typeof model.provider !== "string" ||
		!model.provider.trim()
	) {
		throw new Error("Model provider must be a nonempty string.");
	}
	if (!("id" in model) || typeof model.id !== "string" || !model.id.trim()) {
		throw new Error("Model id must be a nonempty string.");
	}
	if (
		Object.keys(model).some(
			(key) => !["provider", "id", "reasoning"].includes(key),
		)
	) {
		throw new Error("Unknown model settings field.");
	}
	const reasoning =
		"reasoning" in model
			? reasoningLevels.find((level) => level === model.reasoning)
			: undefined;
	if (reasoning === undefined)
		throw new Error("Model reasoning must be a supported thinking-level name.");
	return {
		enabled: value.enabled,
		model: { provider: model.provider, id: model.id, reasoning },
	};
}

export function readConfig(): SuggestionConfig {
	const path = join(getAgentDir(), "suggestions", "config.json");
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return { enabled: false };
		throw new Error(
			`Cannot read suggestions settings at ${path}. Check file permissions, then reopen /suggestions.`,
			{ cause: error },
		);
	}
	try {
		return validateConfig(JSON.parse(source));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Invalid suggestions settings at ${path}: ${detail} Fix or remove this file, then reopen /suggestions.`,
			{ cause: error },
		);
	}
}

export function writeConfig(config: SuggestionConfig): void {
	const path = join(getAgentDir(), "suggestions", "config.json");
	const validated = validateConfig(config);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		try {
			writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
				flag: "wx",
				mode: 0o600,
			});
			renameSync(temporary, path);
		} finally {
			rmSync(temporary, { force: true });
		}
	} catch (error) {
		throw new Error(
			`Cannot save suggestions settings at ${path}. Check directory permissions and available disk space, then retry /suggestions.`,
			{ cause: error },
		);
	}
}
