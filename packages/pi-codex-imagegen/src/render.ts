import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";

interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

type ToolContent =
	| { type: string; text?: string | undefined }
	| { type: "image"; data: string; mimeType: string };

export function renderToolCell(
	title: string,
	detail: string | undefined,
	theme: RenderTheme,
): Text {
	return new Text(
		theme.fg("toolTitle", theme.bold(title)) +
			(detail ? " " + theme.fg("muted", detail) : ""),
		0,
		0,
	);
}

export function renderTextWithImages(
	text: string,
	content: ToolContent[],
	theme: RenderTheme,
): Text | Container {
	const images = content.filter(
		(item): item is { type: "image"; data: string; mimeType: string } =>
			item.type === "image" &&
			"data" in item &&
			typeof item.data === "string" &&
			"mimeType" in item &&
			typeof item.mimeType === "string",
	);
	if (!images.length) return new Text(text, 0, 0);
	const box = new Container();
	box.addChild(new Text(text, 0, 0));
	for (const image of images) {
		box.addChild(new Spacer(1));
		box.addChild(
			new Image(
				image.data,
				image.mimeType,
				{ fallbackColor: (value) => theme.fg("dim", value) },
				{ maxWidthCells: 60 },
			),
		);
	}
	return box;
}
