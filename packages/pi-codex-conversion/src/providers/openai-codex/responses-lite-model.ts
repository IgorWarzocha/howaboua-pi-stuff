type ResponsesLiteModel = string | { id: string } | undefined;

export function isGpt6ModelId(id: string | undefined): boolean {
	return /^gpt-6-(?:astra|sol|luna)$/i.test(id?.split("/").at(-1) ?? "");
}

export function supportsResponsesLiteModel(model: ResponsesLiteModel): boolean {
	const modelId = typeof model === "string" ? model : model?.id;
	if (!modelId) return false;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	return isGpt6ModelId(id) || /^(?:gpt-5\.6-(?:luna|terra|sol)|gpt-daybreak-(?:blue|red)-latest)$/.test(id.toLowerCase());
}
