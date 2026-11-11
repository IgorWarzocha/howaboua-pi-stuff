import { defineTool } from "@earendil-works/pi-coding-agent";
import { compile, obj, opt, type Static, str } from "@earendil-works/pi-schema";
import {
	defaultSessionSkillsDir,
	defaultSkillsDir,
	type LoadedSkill,
	runSkills,
} from "./catalog.js";

const SkillsParameters = obj({
	command: opt(str({ description: "help, list or read" })),
});
const checkParameters = compile(SkillsParameters).check;
type SkillsParameters = Static<typeof SkillsParameters>;

export interface SkillsToolOptions {
	isGpt?(): boolean;
	globalRoot?: string;
	getLoadedSkills?(): readonly LoadedSkill[];
}

export function prepareSkillsCodeModeInput(input: unknown): SkillsParameters {
	if (input === undefined) return {};
	if (typeof input !== "string")
		throw new Error(
			'Expected a string command or no arguments: tools.skills() for discovery, tools.skills("read <skill>") to read',
		);
	return { command: input };
}

export function createSkillsTool(options: SkillsToolOptions = {}) {
	return defineTool({
		name: "skills",
		label: "Skills",
		description: "Load skill instructions and references",
		promptGuidelines: [
			"skills: List once at session start; read always-applicable and task-relevant skills before work",
		],
		parameters: SkillsParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!checkParameters(params))
				throw new Error(
					"Invalid arguments; call skills with no arguments for help",
				);
			const { output, skillReads } = runSkills(
				params.command ?? "",
				options.globalRoot ?? defaultSkillsDir(),
				defaultSessionSkillsDir(ctx.cwd),
				options.getLoadedSkills?.() ?? [],
				options.isGpt?.() ?? false,
			);
			return {
				content: [{ type: "text", text: output }],
				details: { skillReads },
			};
		},
	});
}
