import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { createSkillsTool, prepareSkillsCodeModeInput } from "./src/tool.js";

export { createSkillsTool, prepareSkillsCodeModeInput } from "./src/tool.js";

const REGISTRATION_KEY = Symbol.for(
	"@howaboua/pi-better-skills-tool.registered",
);
const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function skillsExtension(pi: ExtensionAPI): Promise<void> {
	registerPackageChangelog(pi);
	const sharedState = pi.events as typeof pi.events & {
		[REGISTRATION_KEY]?: object;
	};
	if (sharedState[REGISTRATION_KEY]) return;
	const owner = {};
	sharedState[REGISTRATION_KEY] = owner;

	let loadedSkills: readonly Skill[] = [];
	pi.on("before_agent_start", (event) => {
		loadedSkills = event.systemPromptOptions.skills ?? [];
	});
	const tool = createSkillsTool({ getLoadedSkills: () => loadedSkills });
	pi.registerTool(tool);
	const registration = await registerSkillsInCodeMode(pi, tool);
	pi.on("session_shutdown", () => {
		registration?.unregister();
		if (sharedState[REGISTRATION_KEY] === owner)
			delete sharedState[REGISTRATION_KEY];
	});
}

async function registerSkillsInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createSkillsTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				kind: "freeform",
				prepareInput: prepareSkillsCodeModeInput,
				usage:
					'await tools.skills("list") // or "read <skill> [reference-name...]"',
			}),
		]);
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Better Skills with it",
				{ cause: error },
			);
		}
		throw error;
	}
}

function isMissingCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	if (
		error.code !== "ERR_MODULE_NOT_FOUND" &&
		error.code !== "MODULE_NOT_FOUND"
	)
		return false;
	const missing = error.message.match(
		/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
	)?.[1];
	return missing === CODE_MODE_PACKAGE || missing === CODE_MODE_MODULE;
}

function isOutdatedCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(CODE_MODE_MODULE) ||
			(error.message.includes("Package subpath './code-mode'") &&
				error.message.includes(CODE_MODE_PACKAGE)))
	);
}
