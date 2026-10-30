import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModelRole {
	id: string;
	description: string;
	provider: string;
	model: string;
	reasoning: ThinkingLevel;
}

export interface RoleConfig {
	enabled: boolean;
	roles: ModelRole[];
}

function roleConfigPath(): string {
	return join(getAgentDir(), "notes-compaction", "model-roles.json");
}

export function readRoleConfig(path = roleConfigPath()): RoleConfig {
	if (!existsSync(path)) return { enabled: false, roles: [] };
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (
		!value ||
		typeof value !== "object" ||
		!("enabled" in value) ||
		typeof value.enabled !== "boolean" ||
		!("roles" in value) ||
		!Array.isArray(value.roles)
	)
		throw new Error(
			"Model roles configuration must contain enabled and roles; repair it with /roles",
		);
	const ids = new Set<string>();
	const roles = value.roles.map((role: unknown): ModelRole => {
		if (
			!role ||
			typeof role !== "object" ||
			!("id" in role) ||
			typeof role.id !== "string" ||
			!/^[a-z][a-z0-9-]*$/.test(role.id) ||
			!("description" in role) ||
			typeof role.description !== "string" ||
			!role.description.trim() ||
			!("provider" in role) ||
			typeof role.provider !== "string" ||
			!role.provider.trim() ||
			!("model" in role) ||
			typeof role.model !== "string" ||
			!role.model.trim() ||
			!("reasoning" in role) ||
			typeof role.reasoning !== "string" ||
			!THINKING_LEVELS.includes(role.reasoning as ThinkingLevel) ||
			ids.has(role.id)
		)
			throw new Error(
				"Invalid or duplicate model role; repair model-roles.json or use /roles to replace roles",
			);
		ids.add(role.id);
		return {
			id: role.id,
			description: role.description,
			provider: role.provider,
			model: role.model,
			reasoning: role.reasoning as ThinkingLevel,
		};
	});
	return { enabled: value.enabled, roles };
}

export function writeRoleConfig(
	config: RoleConfig,
	path = roleConfigPath(),
): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
}
