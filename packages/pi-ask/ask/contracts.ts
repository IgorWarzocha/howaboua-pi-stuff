import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

const ASK_DELIVERIES = ["wait", "steer"] as const;

const ChoiceSchema = Type.Object({
	label: Type.String(),
	description: Type.Optional(Type.String()),
});

const PromptSchema = Type.Object({
	title: Type.String(),
	body: Type.Optional(Type.String()),
	multiple: Type.Optional(Type.Boolean()),
	choices: Type.Optional(Type.Array(ChoiceSchema)),
});

export const AskParameters = Type.Object({
	handoff: Type.Optional(Type.Boolean()),
	prompts: Type.Array(PromptSchema),
	delivery: Type.Optional(StringEnum(ASK_DELIVERIES)),
});

export type PromptChoice = Static<typeof ChoiceSchema>;

export interface AskPrompt {
	id: string;
	title: string;
	body?: string;
	multiple: boolean;
	choices: PromptChoice[];
}

export interface PendingAsk {
	id: string;
	prompts: AskPrompt[];
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
