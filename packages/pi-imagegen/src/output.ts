import { readFileSync } from "node:fs";

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
	detail: "high" | "original";
}

export interface ImagegenOutput {
	path: string;
	latest_path?: string | null | undefined;
	images?: SavedImage[] | null | undefined;
	background?: string | null | undefined;
	transparent_background?: boolean | null | undefined;
	quality?: string | null | undefined;
	size?: string | null | undefined;
	imagegen_request_id?: string | null | undefined;
}

interface SavedImage {
	path?: string | undefined;
	absolute_path?: string | undefined;
	latest_path?: string | undefined;
	latest_absolute_path?: string | undefined;
}

export function imageContentsFromImagegenOutput(
	output: ImagegenOutput,
): ImageContent[] {
	return (output.images ?? []).flatMap((image) => {
		if (!image.absolute_path) return [];
		try {
			return [
				{
					type: "image" as const,
					mimeType: "image/png",
					data: readFileSync(image.absolute_path).toString("base64"),
					detail: "high" as const,
				},
			];
		} catch {
			return [];
		}
	});
}

export function formatImagegenOutput(output: ImagegenOutput): string {
	return [
		`Generated image: ${output.path}`,
		...(output.latest_path ? [`Latest: ${output.latest_path}`] : []),
		`Transparent background: ${
			output.transparent_background === true
				? "yes"
				: output.transparent_background === false
					? "no"
					: "unreported"
		}`,
	].join("\n");
}
