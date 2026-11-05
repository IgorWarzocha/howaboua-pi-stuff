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
	output_format?: string | undefined;
}

interface SavedImage {
	path?: string | undefined;
	absolute_path?: string | undefined;
	latest_path?: string | undefined;
	latest_absolute_path?: string | undefined;
	mime_type?: string | undefined;
	preview_absolute_path?: string | undefined;
}

export function imageContentsFromImagegenOutput(
	output: ImagegenOutput,
): ImageContent[] {
	return (output.images ?? []).flatMap((image) => {
		if (!image.absolute_path) return [];
		const mime = image.mime_type ?? "image/png";
		if (
			mime === "image/svg+xml" ||
			(mime === "image/gif" && !image.preview_absolute_path)
		)
			return [];
		try {
			return [
				{
					type: "image" as const,
					mimeType: image.preview_absolute_path ? "image/png" : mime,
					data: readFileSync(
						image.preview_absolute_path ?? image.absolute_path,
					).toString("base64"),
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
		...(output.output_format === "gif"
			? ["Saved animation; image preview is a still frame."]
			: []),
		...(output.output_format === "gif" &&
		output.images?.some((image) => !image.preview_absolute_path)
			? ["Still preview unavailable; open the saved GIF to view it."]
			: []),
		...(output.output_format === "svg"
			? ["Saved SVG; no inline preview."]
			: []),
	].join("\n");
}
