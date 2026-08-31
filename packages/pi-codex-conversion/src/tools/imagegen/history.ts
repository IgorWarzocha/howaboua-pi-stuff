import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function recentConversationImageUrls(
	entries: readonly SessionEntry[],
	count: number,
): string[] {
	const images: string[] = [];
	for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
		const entry = entries[entryIndex];
		if (!entry) continue;
		const content = contentFromEntry(entry);
		if (!Array.isArray(content)) continue;
		for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex--) {
			const image = imageDataUrl(content[contentIndex]);
			if (!image) continue;
			images.push(image);
			if (images.length === count) return images.reverse();
		}
	}
	return images.reverse();
}

function contentFromEntry(entry: SessionEntry): unknown {
	if (entry.type === "custom_message") return entry.content;
	if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") return undefined;
	return "content" in entry.message ? entry.message.content : undefined;
}

function imageDataUrl(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const image = value as { type?: unknown; data?: unknown; mimeType?: unknown };
	if (
		image.type !== "image"
		|| typeof image.data !== "string"
		|| image.data.length === 0
		|| typeof image.mimeType !== "string"
		|| !image.mimeType.startsWith("image/")
	) return undefined;
	return `data:${image.mimeType};base64,${image.data}`;
}
