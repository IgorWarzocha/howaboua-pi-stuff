import { readFileSync } from "node:fs";
import type { ViewImageContent } from "../view-image/output.ts";

export interface ImagegenOutput {
	path: string;
	latest_path?: string | undefined;
	images?: Array<{
		path?: string | undefined;
		absolute_path?: string | undefined;
		latest_path?: string | undefined;
		latest_absolute_path?: string | undefined;
	}> | undefined;
	background?: string | undefined;
	quality?: string | undefined;
	size?: string | undefined;
}

export function imagegenOutputFromJson(output: string): ImagegenOutput | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.trim());
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || typeof (parsed as Record<string, unknown>)["path"] !== "string") return undefined;
	return parsed as ImagegenOutput;
}

export function imageContentsFromImagegenOutput(output: ImagegenOutput): ViewImageContent[] {
	return (output.images ?? []).flatMap((image) => {
		if (!image.absolute_path) return [];
		try {
			return [{ type: "image" as const, mimeType: "image/png", data: readFileSync(image.absolute_path).toString("base64"), detail: "high" as const }];
		} catch {
			return [];
		}
	});
}

export function formatImagegenOutput(output: ImagegenOutput): string {
	return [`Generated image: ${output.path}`, ...(output.latest_path ? [`Latest: ${output.latest_path}`] : [])].join("\n");
}
