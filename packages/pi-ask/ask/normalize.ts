import { HANDOFF_CHOICES, OTHER_OPTION_LABEL } from "./constants.js";
import type {
	AskInput,
	AskPrompt,
	AskResponse,
	PromptChoice,
} from "./contracts.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function textContent(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}

function normalizePromptChoice(choice: unknown): PromptChoice | null {
	if (!isRecord(choice)) return null;
	const label =
		typeof choice["label"] === "string" ? choice["label"].trim() : "";
	if (!label || label === OTHER_OPTION_LABEL) return null;
	const description =
		typeof choice["description"] === "string"
			? choice["description"].trim()
			: "";
	return { label, ...(description ? { description } : {}) };
}

function normalizePrompt(
	input: unknown,
	index: number,
	handoff = false,
): AskPrompt | null {
	if (!isRecord(input)) return null;
	const title = typeof input["title"] === "string" ? input["title"].trim() : "";
	if (!title) return null;
	const body = typeof input["body"] === "string" ? input["body"].trim() : "";
	const choices = Array.isArray(input["choices"])
		? input["choices"]
				.map(normalizePromptChoice)
				.filter((choice) => choice !== null)
		: [];
	return {
		id: `p${index + 1}`,
		title,
		...(body ? { body } : {}),
		multiple: input["multiple"] === true,
		choices: handoff && choices.length === 0 ? [...HANDOFF_CHOICES] : choices,
	};
}

export function normalizeAskInput(params: AskInput | null | undefined): {
	handoff: boolean;
	prompts: AskPrompt[];
} {
	const handoff = params?.handoff === true;
	const prompts = Array.isArray(params?.prompts)
		? params.prompts
				.map((prompt, index) => normalizePrompt(prompt, index, handoff))
				.filter((prompt) => prompt !== null)
		: [];
	return { handoff, prompts };
}

export function normalizeResponses(
	prompts: AskPrompt[],
	responses: unknown,
): AskResponse[] | null {
	if (!Array.isArray(responses)) return null;
	return prompts.map((prompt, index) => {
		const response: unknown = responses[index];
		const rawSelections = Array.isArray(response)
			? response
			: isRecord(response) && Array.isArray(response["selections"])
				? response["selections"]
				: [];
		const selections = rawSelections.filter(
			(selection): selection is string => {
				return typeof selection === "string";
			},
		);
		const comment =
			isRecord(response) && typeof response["comment"] === "string"
				? response["comment"].trim()
				: "";
		return {
			id: prompt.id,
			selections,
			...(comment ? { comment } : {}),
		};
	});
}

export function summarizeResponses(
	prompts: AskPrompt[],
	responses: AskResponse[],
): string {
	return responses
		.map((response, index) => {
			const prompt = prompts[index];
			const selection = `${prompt?.title ?? `Prompt ${index + 1}`}: ${response.selections.join(", ") || "No selection"}`;
			return response.comment
				? `${selection}\n  Comment: ${response.comment}`
				: selection;
		})
		.join("\n");
}
