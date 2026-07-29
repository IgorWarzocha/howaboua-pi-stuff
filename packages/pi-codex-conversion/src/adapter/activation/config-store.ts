import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { migrateCodexConversionConfigIfNeeded } from "./config-migration.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG, normalizeCodexConversionConfig, type CodexConversionConfig } from "./config.ts";

// Lite deliberately shares the original package's config so replacing either
// package does not require a reset or a second settings file.
export const CODEX_CONVERSION_CONFIG_BASENAME = "pi-codex-conversion.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfigDocument(existing: Record<string, unknown>, owned: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...existing };
	for (const [key, value] of Object.entries(owned)) {
		const previous = merged[key];
		merged[key] = isRecord(previous) && isRecord(value)
			? mergeConfigDocument(previous, value)
			: value;
	}
	return merged;
}

function clearAbsentOwnedOptionals(document: Record<string, unknown>, owned: Record<string, unknown>): void {
	const voice = isRecord(document["voice"]) ? document["voice"] : undefined;
	const ownedVoice = isRecord(owned["voice"]) ? owned["voice"] : undefined;
	if (!voice || !ownedVoice) return;
	for (const key of ["inputDevice", "outputDevice"])
		if (!(key in ownedVoice)) delete voice[key];
}

export function getCodexConversionConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, CODEX_CONVERSION_CONFIG_BASENAME);
}

export function readCodexConversionConfig(configPath: string = getCodexConversionConfigPath()): CodexConversionConfig {
	if (!existsSync(configPath)) return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		const migration = migrateCodexConversionConfigIfNeeded(parsed);
		return normalizeCodexConversionConfig(migration.config);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to read ${configPath}: ${message}`);
		return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	}
}

export function writeCodexConversionConfig(
	config: CodexConversionConfig,
	configPath: string = getCodexConversionConfigPath(),
): { ok: true } | { ok: false; error: string } {
	const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		mkdirSync(dirname(configPath), { recursive: true });
		const normalized = normalizeCodexConversionConfig(config) as unknown as Record<string, unknown>;
		let document = normalized;
		if (existsSync(configPath)) {
			try {
				const existing = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
				if (isRecord(existing)) document = mergeConfigDocument(existing, normalized);
			} catch {
				// A valid explicit settings write replaces an unreadable document.
			}
		}
		clearAbsentOwnedOptionals(document, normalized);
		writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
		});
		renameSync(temporaryPath, configPath);
		return { ok: true };
	} catch (error) {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {
			// Keep the original write error.
		}
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-codex-conversion] Failed to write ${configPath}: ${message}`);
		return { ok: false, error: message };
	}
}
