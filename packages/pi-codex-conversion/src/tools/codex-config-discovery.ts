import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CODEX_PROVIDER_ID = "openai";

type TomlDocument = { root: Record<string, string>; sections: Map<string, Record<string, string>> };

function codexHome(): string {
	return process.env["CODEX_HOME"]?.trim() || join(homedir(), ".codex");
}

function unquoteTomlString(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length < 2) return undefined;
	const quote = trimmed[0];
	if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) return undefined;
	if (quote === "'") return trimmed.slice(1, -1);
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

function parseTomlStringFields(source: string): TomlDocument {
	const root: Record<string, string> = {};
	const sections = new Map<string, Record<string, string>>();
	let current = root;
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*/, "").trim();
		if (!line) continue;
		const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
		if (sectionMatch) {
			const name = sectionMatch[1]?.trim() ?? "";
			current = sections.get(name) ?? {};
			sections.set(name, current);
			continue;
		}
		const equals = line.indexOf("=");
		if (equals === -1) continue;
		const key = line.slice(0, equals).trim();
		const value = unquoteTomlString(line.slice(equals + 1));
		if (key && value !== undefined) current[key] = value;
	}
	return { root, sections };
}

function providerBaseFromToml(document: TomlDocument): string | undefined {
	const activeProfile = document.root["profile"];
	const profile = activeProfile ? document.sections.get(`profiles.${activeProfile}`) : undefined;
	const providerId = profile?.["model_provider"] ?? document.root["model_provider"] ?? DEFAULT_CODEX_PROVIDER_ID;
	const providerSection = document.sections.get(`model_providers.${providerId}`);
	return providerSection?.["base_url"] ?? (providerId === DEFAULT_CODEX_PROVIDER_ID ? document.root["openai_base_url"] : undefined);
}

export function discoverCodexProviderBaseUrl(configPath: string = join(codexHome(), "config.toml")): string | undefined {
	if (!existsSync(configPath)) return undefined;
	try {
		return providerBaseFromToml(parseTomlStringFields(readFileSync(configPath, "utf-8")))?.trim() || undefined;
	} catch {
		return undefined;
	}
}

