import type { SessionProjection } from "@earendil-works/pi-coding-agent";

export function recentConversationImageUrls(
	messages: Readonly<SessionProjection["messages"]>,
	count: number,
): string[] {
	const images: string[] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || !("content" in message)) continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (
			let contentIndex = content.length - 1;
			contentIndex >= 0;
			contentIndex--
		) {
			const image = imageDataUrl(content[contentIndex]);
			if (!image) continue;
			images.push(image);
			if (images.length === count) return images.reverse();
		}
	}
	return images.reverse();
}

function imageDataUrl(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const image = value as { type?: unknown; data?: unknown; mimeType?: unknown };
	if (
		image.type !== "image" ||
		typeof image.data !== "string" ||
		image.data.length === 0 ||
		typeof image.mimeType !== "string" ||
		!image.mimeType.startsWith("image/")
	)
		return undefined;
	return `data:${image.mimeType};base64,${image.data}`;
}
