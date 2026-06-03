import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CodexVerbosity = "low" | "medium" | "high";
export type CompactionModel = "gpt-5.5" | "gpt-5.3-codex-spark" | "gpt-5.4-mini";
export type CompactionReasoning = "current" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const COMPACTION_MODELS: readonly CompactionModel[] = ["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4-mini"];
export const COMPACTION_REASONING_LEVELS: readonly CompactionReasoning[] = ["current", "minimal", "low", "medium", "high", "xhigh"];

export interface CodexConversionConfig {
	applyPatchOnly: boolean;
	adapterProviders: string[];
	fast: boolean;
	forceCachedWebSockets?: boolean | undefined;
	imageGeneration: boolean;
	compactionModel: CompactionModel;
	compactionReasoning: CompactionReasoning;
	responsesCompaction?: boolean | undefined;
	statusLine: boolean;
	useAdapterProviders: boolean;
	useOnAllModels: boolean;
	webSearch: boolean;
	verbosity: CodexVerbosity;
}

export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";
export const DEFAULT_CODEX_CONVERSION_CONFIG: CodexConversionConfig = {
	applyPatchOnly: false,
	adapterProviders: [],
	fast: false,
	forceCachedWebSockets: true,
	imageGeneration: true,
	compactionModel: "gpt-5.5",
	compactionReasoning: "current",
	responsesCompaction: false,
	statusLine: true,
	useAdapterProviders: false,
	useOnAllModels: false,
	webSearch: true,
	verbosity: "low",
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCodexVerbosity(value: unknown): CodexVerbosity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return normalized === "low" || normalized === "medium" || normalized === "high" ? normalized : undefined;
}

export function normalizeCompactionModel(value: unknown): CompactionModel | undefined {
	if (typeof value !== "string") return undefined;
	return (COMPACTION_MODELS as readonly string[]).includes(value) ? (value as CompactionModel) : undefined;
}

export function normalizeCompactionReasoning(value: unknown): CompactionReasoning | undefined {
	if (typeof value !== "string") return undefined;
	return (COMPACTION_REASONING_LEVELS as readonly string[]).includes(value) ? (value as CompactionReasoning) : undefined;
}

export function normalizeProviderList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean))];
}

export function getCodexConversionConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, CODEX_CONVERSION_CONFIG_BASENAME);
}

export function readCodexConversionConfig(configPath: string = getCodexConversionConfigPath()): CodexConversionConfig {
	if (!existsSync(configPath)) {
		writeCodexConversionConfig(DEFAULT_CODEX_CONVERSION_CONFIG, configPath);
		return { ...DEFAULT_CODEX_CONVERSION_CONFIG };
	}

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (!isObject(parsed)) return { ...DEFAULT_CODEX_CONVERSION_CONFIG };
		return {
			applyPatchOnly: typeof parsed["applyPatchOnly"]! === "boolean" ? parsed["applyPatchOnly"]! : DEFAULT_CODEX_CONVERSION_CONFIG.applyPatchOnly,
			adapterProviders: normalizeProviderList(parsed["adapterProviders"]!),
			fast: typeof parsed["fast"]! === "boolean" ? parsed["fast"]! : DEFAULT_CODEX_CONVERSION_CONFIG.fast,
			forceCachedWebSockets: typeof parsed["forceCachedWebSockets"]! === "boolean" ? parsed["forceCachedWebSockets"]! : DEFAULT_CODEX_CONVERSION_CONFIG.forceCachedWebSockets,
			imageGeneration: typeof parsed["imageGeneration"]! === "boolean" ? parsed["imageGeneration"]! : DEFAULT_CODEX_CONVERSION_CONFIG.imageGeneration,
			compactionModel: normalizeCompactionModel(parsed["compactionModel"]!) ?? DEFAULT_CODEX_CONVERSION_CONFIG.compactionModel,
			compactionReasoning: normalizeCompactionReasoning(parsed["compactionReasoning"]!) ?? DEFAULT_CODEX_CONVERSION_CONFIG.compactionReasoning,
			responsesCompaction: typeof parsed["responsesCompaction"]! === "boolean" ? parsed["responsesCompaction"]! : DEFAULT_CODEX_CONVERSION_CONFIG.responsesCompaction,
			statusLine: typeof parsed["statusLine"]! === "boolean" ? parsed["statusLine"]! : DEFAULT_CODEX_CONVERSION_CONFIG.statusLine,
			useAdapterProviders: typeof parsed["useAdapterProviders"]! === "boolean" ? parsed["useAdapterProviders"]! : DEFAULT_CODEX_CONVERSION_CONFIG.useAdapterProviders,
			useOnAllModels: typeof parsed["useOnAllModels"]! === "boolean" ? parsed["useOnAllModels"]! : DEFAULT_CODEX_CONVERSION_CONFIG.useOnAllModels,
			webSearch: typeof parsed["webSearch"]! === "boolean" ? parsed["webSearch"]! : DEFAULT_CODEX_CONVERSION_CONFIG.webSearch,
			verbosity: normalizeCodexVerbosity(parsed["verbosity"]!) ?? DEFAULT_CODEX_CONVERSION_CONFIG.verbosity,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to read ${configPath}: ${message}`);
		return { ...DEFAULT_CODEX_CONVERSION_CONFIG };
	}
}

export function writeCodexConversionConfig(
	config: CodexConversionConfig,
	configPath: string = getCodexConversionConfigPath(),
): { ok: true } | { ok: false; error: string } {
	try {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to write ${configPath}: ${message}`);
		return { ok: false, error: message };
	}
}

export function applyCodexRequestParams(
	payload: unknown,
	config: CodexConversionConfig,
	options: { serviceTier?: boolean | undefined; verbosity?: boolean | undefined } = { serviceTier: true, verbosity: true },
): unknown {
	if (!isObject(payload)) return payload;
	const text = isObject(payload["text"]!) ? payload["text"]! : {};
	return {
		...payload,
		...(options.serviceTier && config.fast ? { service_tier: "priority" } : {}),
		...(options.verbosity ? { text: { ...text, verbosity: config.verbosity } } : {}),
	};
}
