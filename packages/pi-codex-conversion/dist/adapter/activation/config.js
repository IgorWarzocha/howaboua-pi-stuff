import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { migrateCodexConversionConfigIfNeeded } from "./config-migration.js";
export const HELPER_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark"];
export const COMPACTION_MODELS = HELPER_MODELS;
export const WEB_SEARCH_MODELS = HELPER_MODELS;
export const COMPACTION_REASONING_LEVELS = ["current", "minimal", "low", "medium", "high", "xhigh", "max"];
export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";
export const DEFAULT_CODEX_CONVERSION_CONFIG = {
    mode: "normal",
    scope: { allProviders: "off", additionalProviders: [] },
    tools: { webRun: true, imageGeneration: true, viewImageFallback: false, applyPatchOnly: false, viewImageOnly: false, webRunOnly: false, imageGenerationOnly: false },
    ui: {
        statusLine: true,
        toolRenaming: true,
        compactTools: false,
        backgroundShellWidget: true,
        backgroundShellToggleShortcut: "alt+w",
        backgroundShellPrevShortcut: "alt+q",
        backgroundShellNextShortcut: "alt+e",
        backgroundShellCloseShortcut: "alt+r",
    },
    compaction: { responsesCompaction: false },
    beta: { responsesLite: false },
    openai: {
        fast: false,
        verbosity: "low",
        forceCachedWebSockets: true,
        webSearchModel: "gpt-5.6-luna",
        compactionModel: "gpt-5.6-luna",
        compactionReasoning: "current",
    },
};
export function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeCodexAdapterMode(value) {
    return value === "normal" || value === "path" ? value : undefined;
}
export function normalizeAllProvidersMode(value) {
    if (value === true)
        return "on";
    if (value === false)
        return "off";
    return value === "off" || value === "on" || value === "extras" ? value : undefined;
}
export function normalizeCodexVerbosity(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().toLowerCase();
    return normalized === "low" || normalized === "medium" || normalized === "high" ? normalized : undefined;
}
export function normalizeCompactionModel(value) {
    if (typeof value !== "string")
        return undefined;
    return COMPACTION_MODELS.includes(value) ? value : undefined;
}
export function normalizeWebSearchModel(value) {
    if (typeof value !== "string")
        return undefined;
    return WEB_SEARCH_MODELS.includes(value) ? value : undefined;
}
export function normalizeCompactionReasoning(value) {
    if (typeof value !== "string")
        return undefined;
    return COMPACTION_REASONING_LEVELS.includes(value) ? value : undefined;
}
export function normalizeProviderList(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean))];
}
function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function stringValue(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
export function normalizeCodexConversionConfig(value) {
    if (!isObject(value))
        return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
    const scope = isObject(value["scope"]) ? value["scope"] : {};
    const tools = isObject(value["tools"]) ? value["tools"] : {};
    const ui = isObject(value["ui"]) ? value["ui"] : {};
    const compaction = isObject(value["compaction"]) ? value["compaction"] : {};
    const beta = isObject(value["beta"]) ? value["beta"] : {};
    const openai = isObject(value["openai"]) ? value["openai"] : {};
    return {
        mode: normalizeCodexAdapterMode(value["mode"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.mode,
        scope: {
            allProviders: normalizeAllProvidersMode(scope["allProviders"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
            additionalProviders: normalizeProviderList(scope["additionalProviders"]),
        },
        tools: {
            webRun: bool(tools["webRun"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRun"]),
            imageGeneration: bool(tools["imageGeneration"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGeneration"]),
            viewImageFallback: bool(tools["viewImageFallback"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageFallback"]),
            applyPatchOnly: bool(tools["applyPatchOnly"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"]),
            viewImageOnly: bool(tools["viewImageOnly"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageOnly"]),
            webRunOnly: bool(tools["webRunOnly"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRunOnly"]),
            imageGenerationOnly: bool(tools["imageGenerationOnly"], DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGenerationOnly"]),
        },
        ui: {
            statusLine: bool(ui["statusLine"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["statusLine"]),
            toolRenaming: bool(ui["toolRenaming"], bool(ui["toolRendering"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["toolRenaming"])),
            compactTools: bool(ui["compactTools"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["compactTools"]),
            backgroundShellWidget: bool(ui["backgroundShellWidget"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellWidget"]),
            backgroundShellToggleShortcut: stringValue(ui["backgroundShellToggleShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellToggleShortcut"]),
            backgroundShellPrevShortcut: stringValue(ui["backgroundShellPrevShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellPrevShortcut"]),
            backgroundShellNextShortcut: stringValue(ui["backgroundShellNextShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellNextShortcut"]),
            backgroundShellCloseShortcut: stringValue(ui["backgroundShellCloseShortcut"], DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellCloseShortcut"]),
        },
        compaction: { responsesCompaction: bool(compaction["responsesCompaction"], DEFAULT_CODEX_CONVERSION_CONFIG.compaction["responsesCompaction"]) },
        beta: { responsesLite: bool(beta["responsesLite"], DEFAULT_CODEX_CONVERSION_CONFIG.beta["responsesLite"]) },
        openai: {
            fast: bool(openai["fast"], DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"]),
            verbosity: normalizeCodexVerbosity(openai["verbosity"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
            forceCachedWebSockets: bool(openai["forceCachedWebSockets"], DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"]),
            webSearchModel: normalizeWebSearchModel(openai["webSearchModel"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["webSearchModel"],
            compactionModel: normalizeCompactionModel(openai["compactionModel"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["compactionModel"],
            compactionReasoning: normalizeCompactionReasoning(openai["compactionReasoning"]) ?? DEFAULT_CODEX_CONVERSION_CONFIG.openai["compactionReasoning"],
        },
    };
}
export function getCodexConversionConfigPath(agentDir = getAgentDir()) {
    return join(agentDir, CODEX_CONVERSION_CONFIG_BASENAME);
}
export function readCodexConversionConfig(configPath = getCodexConversionConfigPath()) {
    if (!existsSync(configPath)) {
        writeCodexConversionConfig(DEFAULT_CODEX_CONVERSION_CONFIG, configPath);
        return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
    }
    try {
        const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
        const migration = migrateCodexConversionConfigIfNeeded(parsed);
        const config = normalizeCodexConversionConfig(migration.config);
        if (migration.migrated)
            writeCodexConversionConfig(config, configPath);
        return config;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pi-codex-conversion] Failed to read ${configPath}: ${message}`);
        return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
    }
}
export function writeCodexConversionConfig(config, configPath = getCodexConversionConfigPath()) {
    try {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, `${JSON.stringify(normalizeCodexConversionConfig(config), null, 2)}\n`, "utf-8");
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pi-codex-conversion] Failed to write ${configPath}: ${message}`);
        return { ok: false, error: message };
    }
}
export function applyCodexRequestParams(payload, config, options = { serviceTier: true, verbosity: true }) {
    if (!isObject(payload))
        return payload;
    const text = isObject(payload["text"]) ? payload["text"] : {};
    return {
        ...payload,
        ...(options.serviceTier && config.openai["fast"] ? { service_tier: "priority" } : {}),
        ...(options.verbosity ? { text: { ...text, verbosity: config.openai["verbosity"] } } : {}),
    };
}
