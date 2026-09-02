import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { Type } from "typebox";
import {
	defaultSessionSkillsDir,
	defaultSkillsDir,
	type LoadedSkill,
	runSkills,
} from "./catalog.js";

const SkillsParameters = Type.Object(
	{
		command: Type.String({
			description: "list [category...] | read <skill> [reference...]",
		}),
	},
	{ additionalProperties: false },
);

type SkillsParameters = Static<typeof SkillsParameters>;

export interface SkillsToolOptions {
	globalRoot?: string;
	getLoadedSkills?(): readonly LoadedSkill[];
}

export function prepareSkillsCodeModeInput(input: unknown): SkillsParameters {
	if (typeof input !== "string")
		throw new Error("skills expects a string command");
	return { command: input };
}

export function createSkillsTool(options: SkillsToolOptions = {}) {
	return defineTool({
		name: "skills",
		label: "Skills",
		description: "Active skill catalog, selected references and package paths.",
		promptSnippet: "List or read skill instructions and references",
		promptGuidelines: [
			'skills: At session start call skills once with "list". Before work read one always-applicable or task-relevant skill per call, followed only by that skill\'s references.',
		],
		parameters: SkillsParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const output = runSkills(
				params.command,
				options.globalRoot ?? defaultSkillsDir(),
				defaultSessionSkillsDir(ctx.cwd),
				options.getLoadedSkills?.() ?? [],
			);
			return {
				content: [{ type: "text", text: output }],
				details: {},
			};
		},
	});
}
