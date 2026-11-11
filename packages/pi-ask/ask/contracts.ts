import {
	arr,
	bool,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from "@earendil-works/pi-schema";

const ASK_DELIVERIES = ["wait", "steer"] as const;

const ChoiceSchema = obj(
	{
		label: str(),
		description: opt(str()),
	},
	{ open: true },
);

const PromptSchema = obj(
	{
		title: str(),
		body: opt(str()),
		multiple: opt(bool()),
		choices: opt(arr(ChoiceSchema)),
	},
	{ open: true },
);

export const AskParameters = obj(
	{
		help: opt({ ...lit(true), type: "boolean" }),
		handoff: opt(bool()),
		prompts: opt(arr(PromptSchema)),
		delivery: opt({ ...oneOf(ASK_DELIVERIES), type: "string" }),
	},
	{ open: true },
);

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
