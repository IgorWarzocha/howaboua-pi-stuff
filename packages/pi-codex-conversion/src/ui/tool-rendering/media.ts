import { type Component, Container, Image, Spacer, Text } from "@earendil-works/pi-tui";

interface ImageContentLike {
	type: "image";
	data: string;
	mimeType: string;
}

type ToolContentLike = { type: string; text?: string | undefined } | ImageContentLike;

export interface RenderedImage {
	data: string;
	mimeType: string;
	component: Image;
}

class MediaResult extends Container {
	readonly images: RenderedImage[] = [];
}

function isImageContent(item: ToolContentLike): item is ImageContentLike {
	return item.type === "image" && "data" in item && typeof item.data === "string" && "mimeType" in item && typeof item.mimeType === "string";
}

export function renderTextWithImages(
	text: string,
	content: ToolContentLike[],
	theme: { fg(role: string, text: string): string },
	options: {
		paddingX?: number | undefined;
		maxHeightCells?: number | undefined;
		showImages?: boolean | undefined;
		imageCache?: RenderedImage[] | undefined;
		lastComponent?: Component | undefined;
	} = {},
): Text | Container {
	const images = content.filter(isImageContent);
	if (!images.length) return new Text(text, options.paddingX ?? 0, 0);
	const box = options.lastComponent instanceof MediaResult ? options.lastComponent : new MediaResult();
	const cache = options.imageCache ?? box.images;
	box.clear();
	if (text) box.addChild(new Text(text, options.paddingX ?? 0, 0));
	// Keep hidden images detached but cached so show/hide does not discard their image IDs.
	if (options.showImages === false) return box;
	for (const [index, image] of images.entries()) {
		if (text || index > 0) box.addChild(new Spacer(1));
		const previous = cache[index];
		const component = previous?.data === image.data && previous.mimeType === image.mimeType
			? previous.component
			: new Image(image.data, image.mimeType, { fallbackColor: (value) => theme.fg("dim", value) }, {
				maxWidthCells: 60,
				...(options.maxHeightCells === undefined ? {} : { maxHeightCells: options.maxHeightCells }),
			});
		cache[index] = { data: image.data, mimeType: image.mimeType, component };
		box.addChild(component);
	}
	cache.length = images.length;
	return box;
}
