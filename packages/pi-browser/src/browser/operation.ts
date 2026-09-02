import type { SnapshotResponseLength } from "../cdp/snapshot-contract.js";

export const BROWSER_ACTIONS = [
	"help",
	"start",
	"tabs",
	"open",
	"find",
	"click",
	"type",
	"screenshot",
	"html",
	"navigate",
	"evaluate",
	"network",
	"load_all",
	"raw",
	"read_result",
	"discard_result",
	"stop",
] as const;

export const OPERATION_ORDER = BROWSER_ACTIONS.filter(
	(action) => action !== "help",
);

export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export type BrowserOperation =
	| { action: "start" }
	| { action: "tabs"; query?: string | undefined; offset: number }
	| {
			action: "open";
			ref_id: string;
			lineno: number;
			response_length: SnapshotResponseLength;
	  }
	| { action: "open"; url: string }
	| {
			action: "find";
			ref_id: string;
			pattern: string;
			lineno: number;
			response_length: SnapshotResponseLength;
	  }
	| {
			action: "click";
			ref_id: string;
			id: number;
			selector?: never;
			x?: never;
			y?: never;
	  }
	| {
			action: "click";
			ref_id: string;
			id?: never;
			selector: string;
			x?: never;
			y?: never;
	  }
	| {
			action: "click";
			ref_id: string;
			id?: never;
			selector?: never;
			x: number;
			y: number;
	  }
	| {
			action: "type";
			ref_id: string;
			id?: number | undefined;
			text: string;
	  }
	| {
			action: "screenshot";
			ref_id: string;
			id?: number | undefined;
			selector?: string | undefined;
	  }
	| {
			action: "html";
			ref_id: string;
			id?: number | undefined;
			selector?: string | undefined;
	  }
	| { action: "navigate"; ref_id: string; url: string }
	| { action: "evaluate"; ref_id: string; expression: string }
	| { action: "network"; ref_id: string }
	| {
			action: "load_all";
			ref_id: string;
			selector: string;
			interval_ms: number;
	  }
	| {
			action: "raw";
			ref_id: string;
			method: string;
			params: Record<string, unknown>;
	  }
	| { action: "read_result"; handle: string; offset: number }
	| { action: "discard_result"; handle: string }
	| { action: "stop"; ref_id?: string | undefined };
