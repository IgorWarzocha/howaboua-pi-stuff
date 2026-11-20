import type { RuntimeToolResult, RuntimeToolTrace } from "./types.js";

type TraceImage = Extract<
	RuntimeToolResult["content"][number],
	{ type: "image" }
>;
type ImageBytes = Pick<TraceImage, "mimeType" | "data">;

// Match occurrences, not just identities. A cell may return or emit identical
// images multiple times, and Pi renders every occurrence in outer content.
export function matchEmittedImages(images: readonly ImageBytes[]) {
	const consumed = new Set<number>();
	return (image: ImageBytes): number =>
		images.findIndex((candidate, index) => {
			if (
				consumed.has(index) ||
				candidate.mimeType !== image.mimeType ||
				candidate.data !== image.data
			)
				return false;
			consumed.add(index);
			return true;
		});
}

export function referenceEmittedTraceImages(
	traces: RuntimeToolTrace[],
	images: readonly ImageBytes[],
): RuntimeToolTrace[] {
	if (images.length === 0) return traces;
	const match = matchEmittedImages(images);
	return traces.map((trace) => {
		if (!trace.result) return trace;
		const refs: NonNullable<RuntimeToolTrace["emittedImages"]> = [];
		const content = trace.result.content.filter((item, contentIndex) => {
			if (item.type !== "image") return true;
			const imageIndex = match(item);
			if (imageIndex < 0) return true;
			refs.push({ contentIndex, imageIndex });
			return false;
		});
		return refs.length
			? { ...trace, result: { ...trace.result, content }, emittedImages: refs }
			: trace;
	});
}

export function restoreEmittedTraceImages(
	trace: RuntimeToolTrace,
	images: readonly ImageBytes[],
): RuntimeToolResult | undefined {
	const { result, emittedImages } = trace;
	if (!result || !emittedImages?.length) return result;
	const content = [...result.content];
	let missing = 0;
	for (const { contentIndex, imageIndex } of emittedImages) {
		const image = images[imageIndex];
		if (image) {
			content.splice(contentIndex - missing, 0, {
				type: "image",
				mimeType: image.mimeType,
				data: image.data,
			});
		} else {
			missing++;
		}
	}
	return { ...result, content };
}
