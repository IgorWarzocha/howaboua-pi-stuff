import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface CodexToolRouteConfig {
	providers: Record<string, Record<string, string>>;
}

interface CodexToolRouteConfigInput {
	providers?: unknown;
}

function codexToolRouteConfigPath(): string {
	const agentDir =
		process.env["PI_CODING_AGENT_DIR"]?.trim() ||
		join(homedir(), ".pi", "agent");
	return join(agentDir, "pi-codex-tools.json");
}

function nonEmptyName(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(field + " must be a non-empty string");
	return value.trim();
}

export function normalizeCodexToolRouteConfig(
	value: unknown,
): CodexToolRouteConfig {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("pi-codex-tools config must be an object");
	const input = value as CodexToolRouteConfigInput;
	const rawProviders = input.providers ?? {};
	if (
		!rawProviders ||
		typeof rawProviders !== "object" ||
		Array.isArray(rawProviders)
	)
		throw new Error("pi-codex-tools providers must be an object");
	const providers: Record<string, Record<string, string>> = Object.create(null);
	for (const [provider, rawModels] of Object.entries(rawProviders)) {
		const providerName = nonEmptyName(
			provider,
			"pi-codex-tools provider name",
		).toLowerCase();
		if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels))
			throw new Error(
				"pi-codex-tools provider " + providerName + " must be an object",
			);
		const models: Record<string, string> = Object.create(null);
		for (const [canonical, alias] of Object.entries(rawModels)) {
			models[
				nonEmptyName(canonical, "pi-codex-tools model name").toLowerCase()
			] = nonEmptyName(alias, "pi-codex-tools model alias");
		}
		providers[providerName] = models;
	}
	return { providers };
}

export function readCodexToolRouteConfig(
	path = codexToolRouteConfigPath(),
): CodexToolRouteConfig {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return { providers: Object.create(null) };
		throw error;
	}
	try {
		return normalizeCodexToolRouteConfig(JSON.parse(source));
	} catch (error) {
		throw new Error(
			"Invalid pi-codex-tools config at " +
				path +
				": " +
				(error instanceof Error ? error.message : String(error)),
		);
	}
}

export function isCodexToolRoute(
	config: CodexToolRouteConfig,
	model: ExtensionContext["model"],
): boolean {
	const provider = model?.provider?.trim().toLowerCase();
	return Boolean(provider && Object.hasOwn(config.providers, provider));
}

export function resolveCodexToolModel(
	config: CodexToolRouteConfig,
	model: ExtensionContext["model"],
	canonicalModel: string,
): string {
	const provider = model?.provider?.trim().toLowerCase();
	const models =
		provider && Object.hasOwn(config.providers, provider)
			? config.providers[provider]
			: undefined;
	return models?.[canonicalModel.trim().toLowerCase()] || canonicalModel;
}
