import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const PROFILES_DIRECTORY = join(
	process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent"),
	"shepherdr2",
	"profiles",
);

export interface AgentProfile {
	accepts: string[];
	description: string;
	model?: string;
	name: string;
	piArgs: string[];
	prepare?: string;
	prompt?: string;
	thinking?: string;
}

interface ProfileFile {
	accepts?: unknown;
	description?: unknown;
	model?: unknown;
	pi_args?: unknown;
	prepare?: unknown;
	prompt?: unknown;
	thinking?: unknown;
}

const BUILT_IN_PROFILES: readonly AgentProfile[] = [
	{
		accepts: [],
		description: "General implementation and investigation",
		name: "general",
		piArgs: [],
	},
	{
		accepts: [],
		description: "Read-only discovery",
		name: "explorer",
		piArgs: [],
		prompt:
			"You are a read-only explorer. Treat the task as the complete brief. Do not change files or Git state, propose implementation, or spawn agents.",
	},
	{
		accepts: ["base"],
		description: "Read-only review",
		name: "reviewer",
		piArgs: [],
		prompt:
			"You are a read-only reviewer. Treat the task as the complete brief. Do not change files or Git state or spawn agents.",
	},
];

function stringArray(value: unknown, field: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || item.length === 0)
	) {
		throw new Error(`${field} must be an array of non-empty strings`);
	}
	return value;
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

async function readProfile(
	name: string,
	directory: string,
): Promise<AgentProfile> {
	const path = join(directory, "profile.json");
	let parsed: ProfileFile;
	try {
		parsed = JSON.parse(await readFile(path, "utf8")) as ProfileFile;
	} catch (error) {
		throw new Error(
			`invalid ${name} profile: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${name} profile must be an object`);
	}
	const allowed = new Set([
		"accepts",
		"description",
		"model",
		"pi_args",
		"prepare",
		"prompt",
		"thinking",
	]);
	const unknown = Object.keys(parsed).filter((key) => !allowed.has(key));
	if (unknown.length > 0) {
		throw new Error(`unknown ${name} profile field(s): ${unknown.join(", ")}`);
	}
	const description = optionalString(parsed.description, `${name}.description`);
	if (!description) throw new Error(`${name}.description is required`);
	const promptPath = optionalString(parsed.prompt, `${name}.prompt`);
	const preparePath = optionalString(parsed.prepare, `${name}.prepare`);
	const prompt = promptPath
		? await readFile(resolve(directory, promptPath), "utf8")
		: undefined;
	const prepare = preparePath ? resolve(directory, preparePath) : undefined;
	if (prepare && !(await stat(prepare)).isFile()) {
		throw new Error(`${name}.prepare is not a file`);
	}
	return {
		name,
		description,
		accepts: parsed.accepts
			? stringArray(parsed.accepts, `${name}.accepts`)
			: [],
		piArgs: parsed.pi_args
			? stringArray(parsed.pi_args, `${name}.pi_args`)
			: [],
		...(optionalString(parsed.model, `${name}.model`)
			? { model: optionalString(parsed.model, `${name}.model`)! }
			: {}),
		...(optionalString(parsed.thinking, `${name}.thinking`)
			? { thinking: optionalString(parsed.thinking, `${name}.thinking`)! }
			: {}),
		...(prompt ? { prompt } : {}),
		...(prepare ? { prepare } : {}),
	};
}

export async function loadAgentProfiles(): Promise<Map<string, AgentProfile>> {
	const profiles = new Map(
		BUILT_IN_PROFILES.map((profile) => [profile.name, profile]),
	);
	let entries;
	try {
		entries = await readdir(PROFILES_DIRECTORY, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return profiles;
		throw error;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (!PROFILE_NAME.test(entry.name)) {
			throw new Error(`invalid agent profile directory: ${entry.name}`);
		}
		profiles.set(
			entry.name,
			await readProfile(entry.name, join(PROFILES_DIRECTORY, entry.name)),
		);
	}
	return profiles;
}

export function profileAgentArgs(
	profile: AgentProfile,
	ctx: ExtensionContext,
): string[] {
	const inheritedModel = ctx.model
		? `${ctx.model.provider}/${ctx.model.id}`
		: undefined;
	const model = profile.model ?? inheritedModel;
	const thinking = profile.thinking ?? ctx.thinkingLevel;
	return [
		...(model ? ["--model", model] : []),
		...(thinking ? ["--thinking", thinking] : []),
		...(profile.prompt ? ["--append-system-prompt", profile.prompt] : []),
		...profile.piArgs,
	];
}

export async function prepareProfileMessage(
	profile: AgentProfile,
	input: { base?: string; cwd: string; message: string },
): Promise<string> {
	if (input.base && !profile.accepts.includes("base")) {
		throw new Error(`base is not supported by ${profile.name}`);
	}
	if (profile.prepare) {
		const metadata = await stat(profile.prepare);
		const module = (await import(
			`${pathToFileURL(profile.prepare).href}?mtime=${metadata.mtimeMs}`
		)) as { prepare?: (value: typeof input) => unknown };
		if (typeof module.prepare !== "function") {
			throw new Error(`${profile.name}.prepare must export prepare()`);
		}
		const prepared = await module.prepare(input);
		if (typeof prepared !== "string" || prepared.trim().length === 0) {
			throw new Error(`${profile.name}.prepare must return a non-empty string`);
		}
		return prepared;
	}
	return input.base
		? `Review base: ${input.base}\n\n${input.message}`
		: input.message;
}
