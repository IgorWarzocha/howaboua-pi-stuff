import { type Static, Type } from "typebox";

const ChoiceSchema = Type.Object({
	label: Type.String({ description: "Short choice." }),
	description: Type.Optional(Type.String({ description: "Optional detail." })),
});

const PromptSchema = Type.Object({
	title: Type.String({ description: "Short prompt." }),
	body: Type.Optional(Type.String({ description: "Context or evidence." })),
	multiple: Type.Optional(Type.Boolean({ description: "Allow multiple." })),
	choices: Type.Optional(
		Type.Array(ChoiceSchema, { description: "Choices; omit for free text." }),
	),
});

export const AskParameters = Type.Object({
	handoff: Type.Optional(
		Type.Boolean({ description: "Wait for user action." }),
	),
	prompts: Type.Array(PromptSchema, { description: "Prompts." }),
});

export type AskInput = Static<typeof AskParameters>;
export type PromptChoice = Static<typeof ChoiceSchema>;

export interface AskPrompt {
	id: string;
	title: string;
	body?: string;
	multiple: boolean;
	choices: PromptChoice[];
}

export interface AskResponse {
	id: string;
	selections: string[];
	comment?: string;
}

export interface PromptState {
	selections: string[];
	customText: string;
	customEnabled: boolean;
	comment: string;
}
