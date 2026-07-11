import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";
function isImageContent(item) {
    return item.type === "image" && "data" in item && typeof item.data === "string" && "mimeType" in item && typeof item.mimeType === "string";
}
export function renderTextWithImages(text, content, theme, options = {}) {
    const images = content.filter(isImageContent);
    if (!images.length)
        return new Text(text, options.paddingX ?? 0, 0);
    const box = new Container();
    box.addChild(new Text(text, options.paddingX ?? 0, 0));
    for (const image of images) {
        box.addChild(new Spacer(1));
        box.addChild(new Image(image.data, image.mimeType, { fallbackColor: (value) => theme.fg("dim", value) }, { maxWidthCells: 60 }));
    }
    return box;
}
