export type ViewImageContent = { type: "image"; data: string; mimeType: string; detail: "high" | "original" };

export function imageContentsFromViewImageDetails(details: unknown): ViewImageContent[] {
	if (!details || typeof details !== "object") return [];
	const description = (details as { viewImageDescription?: unknown }).viewImageDescription;
	if (!description || typeof description !== "object") return [];
	const image = (description as { image?: unknown }).image;
	return isViewImageContent(image) ? [image] : [];
}

export function imageContentFromViewImageOutput(output: string): ViewImageContent | undefined {
	return imageContentsFromViewImageOutput(output)[0];
}

export function imageContentsFromViewImageOutput(output: string): ViewImageContent[] {
	const trimmed = output.trim();
	if (!trimmed) return [];
	const whole = imageContentFromJson(trimmed);
	if (whole) return [whole];
	return trimmed.split(/\r?\n/).flatMap((line) => {
		const image = imageContentFromJson(line.trim());
		return image ? [image] : [];
	});
}

function imageContentFromJson(json: string): ViewImageContent | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const imageUrl = (parsed as Record<string, unknown>)["image_url"];
	const detail = (parsed as Record<string, unknown>)["detail"];
	if (typeof imageUrl !== "string" || (detail !== "high" && detail !== "original")) return undefined;
	const match = imageUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
	return match ? { type: "image", mimeType: match[1]!, data: match[2]!, detail } : undefined;
}

function isViewImageContent(value: unknown): value is ViewImageContent {
	return Boolean(value && typeof value === "object"
		&& (value as { type?: unknown }).type === "image"
		&& typeof (value as { data?: unknown }).data === "string"
		&& typeof (value as { mimeType?: unknown }).mimeType === "string"
		&& ((value as { detail?: unknown }).detail === "high" || (value as { detail?: unknown }).detail === "original"));
}
