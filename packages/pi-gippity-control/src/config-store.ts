import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_GIPPITY_CONTROL_CONFIG,
	type GippityControlConfig,
	normalizeGippityControlConfig,
} from "./config.ts";

const GIPPITY_CONTROL_CONFIG_BASENAME = "pi-gippity-control.json";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDocument(
	existing: Record<string, unknown>,
	owned: Record<string, unknown>,
): Record<string, unknown> {
	const merged = { ...existing };
	for (const [key, value] of Object.entries(owned)) {
		const previous = merged[key];
		merged[key] =
			isObject(previous) && isObject(value)
				? mergeDocument(previous, value)
				: value;
	}
	return merged;
}

function clearAbsentOwnedOptionals(
	document: Record<string, unknown>,
	owned: Record<string, unknown>,
): void {
	const voice = isObject(document["voice"]) ? document["voice"] : undefined;
	const ownedVoice = isObject(owned["voice"]) ? owned["voice"] : undefined;
	if (!voice || !ownedVoice) return;
	for (const key of ["contextModel", "inputDevice", "outputDevice"])
		if (!(key in ownedVoice)) delete voice[key];
}

export function getGippityControlConfigPath(
	agentDir: string = getAgentDir(),
): string {
	return join(agentDir, GIPPITY_CONTROL_CONFIG_BASENAME);
}

export function readGippityControlConfig(
	configPath: string = getGippityControlConfigPath(),
): GippityControlConfig {
	if (!existsSync(configPath))
		return structuredClone(DEFAULT_GIPPITY_CONTROL_CONFIG);
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
		const config = normalizeGippityControlConfig(parsed);
		const voice =
			isObject(parsed) && isObject(parsed["voice"])
				? parsed["voice"]
				: undefined;
		if (typeof voice?.["audioSetupCompleted"] !== "boolean")
			config.voice.audioSetupCompleted = true;
		return config;
	} catch (error) {
		console.warn(
			`[pi-gippity-control] Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return structuredClone(DEFAULT_GIPPITY_CONTROL_CONFIG);
	}
}

export function writeGippityControlConfig(
	config: GippityControlConfig,
	configPath: string = getGippityControlConfigPath(),
): { ok: true } | { ok: false; error: string } {
	const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		mkdirSync(dirname(configPath), { recursive: true });
		const normalized = normalizeGippityControlConfig(
			config,
		) as unknown as Record<string, unknown>;
		let document = normalized;
		if (existsSync(configPath)) {
			try {
				const existing = JSON.parse(
					readFileSync(configPath, "utf8"),
				) as unknown;
				if (isObject(existing)) document = mergeDocument(existing, normalized);
			} catch {
				// An explicit write replaces an unreadable document.
			}
		}
		clearAbsentOwnedOptionals(document, normalized);
		writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, configPath);
		return { ok: true };
	} catch (error) {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {
			/* preserve the write error */
		}
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
