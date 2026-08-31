import { readFileSync } from "node:fs";
import type { ViewImageContent } from "../view-image/output.ts";

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

export function imagegenOutputFromJson(output: string): ImagegenOutput | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.trim());
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const value = parsed as Record<string, unknown>;
	if (
		typeof value["path"] !== "string"
		|| !optionalNullableString(value["latest_path"])
		|| !optionalNullableString(value["background"])
		|| (value["transparent_background"] !== undefined
			&& value["transparent_background"] !== null
			&& typeof value["transparent_background"] !== "boolean")
		|| !optionalNullableString(value["quality"])
		|| !optionalNullableString(value["size"])
		|| !optionalNullableString(value["imagegen_request_id"])
		|| (value["images"] !== undefined && value["images"] !== null && (
			!Array.isArray(value["images"])
			|| !value["images"].every(isSavedImage)
		))
	) return undefined;
	return parsed as ImagegenOutput;
}

function optionalNullableString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isSavedImage(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const image = value as Record<string, unknown>;
	return optionalString(image["path"])
		&& optionalString(image["absolute_path"])
		&& optionalString(image["latest_path"])
		&& optionalString(image["latest_absolute_path"]);
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
