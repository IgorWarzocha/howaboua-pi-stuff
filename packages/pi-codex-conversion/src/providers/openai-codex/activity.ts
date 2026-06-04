import { buildGeneratedImageDisplayText } from "./image-output.ts";
import { getNodeFsSync } from "./node-runtime.ts";
import { IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, WEB_SEARCH_ACTIVITY_MESSAGE_TYPE } from "./constants.ts";
import type { CachedImagePreview, ImageDisplayMessageDetails, PendingActivity, QueuedWebSearchActivity, SavedGeneratedImage, SendActivityMessage, StreamEventShape, SurfacedWebSearch } from "./types.ts";

export function extractWebSearch(item: StreamEventShape["item"]): SurfacedWebSearch | undefined {
	if (!item || item.type !== "web_search_call") return undefined;
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) return undefined;

	const action = typeof item["action"]! === "object" && item["action"] !== null ? (item["action"]! as Record<string, unknown>) : undefined;
	const query = typeof action?.["query"] === "string" ? action["query"]! : undefined;
	const queries = Array.isArray(action?.["queries"]) ? action["queries"]!.filter((value): value is string => typeof value === "string") : [];
	const sourceUrls = Array.isArray(action?.["sources"])
		? action["sources"]!
				.map((source) => (typeof source === "object" && source !== null ? (source as Record<string, unknown>) : undefined))
				.map((source) => (typeof source?.["url"] === "string" ? source["url"]! : undefined))
				.filter((url): url is string => typeof url === "string")
		: [];

	const results = Array.isArray(item["results"]!)
		? item["results"]!
				.map((result) => (typeof result === "object" && result !== null ? (result as Record<string, unknown>) : undefined))
				.filter((result): result is Record<string, unknown> => !!result)
		: [];

	const titledSources: Array<{ title?: string | undefined; url: string }> = [];
	for (const result of results) {
		if (typeof result["url"]! !== "string") continue;
		titledSources.push({
			title: typeof result["title"]! === "string" ? result["title"]! : undefined,
			url: result["url"]!,
		});
	}

	const seenUrls = new Set<string>();
	const sources: Array<{ title?: string | undefined; url: string }> = [];
	for (const source of titledSources) {
		if (seenUrls.has(source.url)) continue;
		seenUrls.add(source.url);
		sources.push(source);
	}
	for (const url of sourceUrls) {
		if (seenUrls.has(url)) continue;
		seenUrls.add(url);
		sources.push({ url });
	}

	return {
		callId,
		status: typeof item.status === "string" ? item.status : undefined,
		query,
		queries,
		sources,
	};
}

export function buildWebSearchActivityMessage(searches: SurfacedWebSearch[]): string {
	const sections = searches.map((search, index) => {
		const heading = searches.length > 1 ? `Web search results ${index + 1}` : "Web search results";
		const lines = [heading];
		const queries = search.queries.length > 0 ? search.queries : search.query ? [search.query] : [];
		if (queries.length > 0) {
			lines.push("Queries:");
			for (const query of queries) {
				lines.push(`- ${query}`);
			}
		}
		if (search.sources.length > 0) {
			lines.push("Sources:");
			for (const source of search.sources.slice(0, 5)) {
				lines.push(`- ${source.title ? `${source.title} — ` : ""}${source.url}`);
			}
		}
		return lines.join("\n");
	});

	return sections.join("\n\n");
}

export function buildWebSearchSummaryText(searches: SurfacedWebSearch[]): string {
	return searches.length === 1 ? "Searched the web once" : `Searched the web ${searches.length} times`;
}

function sendActivityMessages(
	sendMessage: SendActivityMessage,
	imagePreviewCache: Map<string, CachedImagePreview>,
	activities: PendingActivity[],
): void {
	for (let index = 0; index < activities.length; index++) {
		const activity = activities[index]!;
		if (activity.kind === "image") {
			imagePreviewCache.set(activity.savedImage.absolutePath, activity.imageData);
			sendMessage(
				{
					customType: IMAGE_SAVE_DISPLAY_MESSAGE_TYPE,
					content: [{ type: "text", text: buildGeneratedImageDisplayText(activity.savedImage, { expanded: false }) }],
					display: true,
					details: { savedImages: [activity.savedImage] } satisfies ImageDisplayMessageDetails,
				},
				{ triggerTurn: false },
			);
			continue;
		}

		const searches = [activity.search];
		while (index + 1 < activities.length && (activities[index + 1])!?.kind === "web-search") {
			searches.push((activities[++index]! as QueuedWebSearchActivity).search);
		}
		sendMessage(
			{
				customType: WEB_SEARCH_ACTIVITY_MESSAGE_TYPE,
				content: buildWebSearchActivityMessage(searches),
				display: true,
				details: { searches },
			},
			{ triggerTurn: false },
		);
	}
}

export function createActivityMessageDispatcher(sendMessage: SendActivityMessage): {
	imagePreviewCache: Map<string, CachedImagePreview>;
	enqueueSettledActivities(activities: PendingActivity[]): void;
	flushNow(): void;
	scheduleFlush(): void;
	clear(): void;
} {
	const completedActivities: PendingActivity[] = [];
	const imagePreviewCache = new Map<string, CachedImagePreview>();
	let pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;

	const flush = () => {
		pendingFlushTimer = undefined;
		const activities = completedActivities.splice(0, completedActivities.length);
		if (activities.length > 0) sendActivityMessages(sendMessage, imagePreviewCache, activities);
	};

	return {
		imagePreviewCache,
		enqueueSettledActivities(activities) {
			completedActivities.push(...activities);
		},
		flushNow() {
			if (pendingFlushTimer) {
				clearTimeout(pendingFlushTimer);
				pendingFlushTimer = undefined;
			}
			flush();
		},
		scheduleFlush() {
			if (pendingFlushTimer || completedActivities.length === 0) return;
			pendingFlushTimer = setTimeout(flush, 0);
		},
		clear() {
			if (pendingFlushTimer) {
				clearTimeout(pendingFlushTimer);
				pendingFlushTimer = undefined;
			}
			completedActivities.length = 0;
			imagePreviewCache.clear();
		},
	};
}

export function loadCachedImagePreview(savedImage: SavedGeneratedImage, imagePreviewCache: Map<string, CachedImagePreview>): CachedImagePreview | undefined {
	const cached = imagePreviewCache.get(savedImage.absolutePath);
	if (cached) return cached;
	const fs = getNodeFsSync();
	if (!fs) return undefined;
	try {
		const preview = {
			data: fs.readFileSync(savedImage.absolutePath).toString("base64"),
			mimeType: `image/${savedImage.outputFormat}`,
		};
		imagePreviewCache.set(savedImage.absolutePath, preview);
		return preview;
	} catch {
		return undefined;
	}
}
