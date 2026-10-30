import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const REALTIME_WEB_SEARCH_SERVICE = "@howaboua/pi-codex-web-run.service/v1";
interface WebSearchService {
	protocol: 1;
	run(
		ctx: ExtensionContext,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<{ text: string }>;
}
export function discoverRealtimeWebSearch(
	pi: Pick<ExtensionAPI, "events">,
): WebSearchService | undefined {
	let service: WebSearchService | undefined;
	pi.events.emit(REALTIME_WEB_SEARCH_SERVICE, {
		use(value: unknown) {
			if (
				value &&
				typeof value === "object" &&
				"protocol" in value &&
				value.protocol === 1 &&
				"run" in value &&
				typeof value.run === "function"
			)
				service = value as WebSearchService;
		},
	});
	return service;
}
export function hasRealtimeWebSearch(
	pi: Pick<ExtensionAPI, "events">,
): boolean {
	return Boolean(discoverRealtimeWebSearch(pi));
}
