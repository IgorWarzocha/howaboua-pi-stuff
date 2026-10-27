export interface SearchItem {
	item_id: string;
	content: string;
}
export type SearchRequest =
	| {
			action: "index";
			sessionId: string;
			file: string | undefined;
			items: readonly SearchItem[];
			removeIds: string[];
	  }
	| {
			action: "search";
			sessionId: string;
			ids: string[];
			match: string;
			limit: number;
			recentFirst: boolean;
	  }
	| {
			action: "prune_session";
			sessionId: string;
			file: string;
	  }
	| {
			action: "prune";
			activeSessionId: string;
			sources: Record<string, string | null>;
	  };
export interface PruneResult {
	removed: number;
	unknownPaths: number;
	inaccessible: number;
	storageBusy: boolean;
}
export type SearchResponse =
	| { id: number; value: string[] | PruneResult | null }
	| { id: number; error: string };
