import {
	type ImagegenOutput,
	imageContentsFromImagegenOutput,
} from "./output.js";

interface ResultContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
	detail?: string;
}

function resultText(content: ResultContent[]): string {
	return content
		.filter(
			(item): item is ResultContent & { text: string } =>
				item.type === "text" && typeof item.text === "string",
		)
		.map((item) => item.text)
		.join("\n");
}

export function imagegenCodeModeResult(result: {
	content: ResultContent[];
	details?: unknown;
}): unknown {
	let image = result.content.find(
		(item) =>
			item.type === "image" &&
			typeof item.data === "string" &&
			typeof item.mimeType === "string",
	);
	if (
		!image &&
		result.details &&
		typeof result.details === "object" &&
		"path" in result.details &&
		typeof result.details.path === "string"
	)
		image = imageContentsFromImagegenOutput(
			result.details as ImagegenOutput,
		)[0];
	const outputHint = resultText(result.content);
	if (!image || typeof image.data !== "string" || !image.mimeType)
		return outputHint || "(no output)";
	return {
		image_url: "data:" + image.mimeType + ";base64," + image.data,
		detail: image.detail ?? "high",
		...(outputHint ? { output_hint: outputHint } : {}),
	};
}
