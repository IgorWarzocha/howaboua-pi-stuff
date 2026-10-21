export type Outcome = "ok" | "error" | "nonzero" | "incomplete" | "unknown";

export interface Counts {
	calls: number;
	ok: number;
	error: number;
	nonzero: number;
	incomplete: number;
	unknown: number;
}

export interface OutcomeGroup {
	tool: string;
	provider: string;
	model: string;
	signature: string;
	count: number;
	lastSeen: string;
}

export interface Overview {
	totals: Counts;
	byModel: Array<Counts & { provider: string; model: string }>;
	byTool: Array<Counts & { tool: string }>;
	groups: OutcomeGroup[];
	exits: OutcomeGroup[];
	daily: Array<Counts & { day: string }>;
}

export interface IndexStatus {
	phase: "starting" | "indexing" | "idle" | "error";
	revision: number;
	files: number;
	entries: number;
	bytesRead: number;
	lastScan: string | null;
	error: string | null;
	issues: Array<{ path: string; message: string }>;
	coverage: {
		malformedLines: number;
		unpairedResults: number;
		wrappersWithoutTraces: number;
		droppedTraces: number;
		nativeIncomplete: number;
		uncorrelatedNativeOmitted: number;
		unreadableCachedResults: number;
		unmatchedObservations: number;
	};
}

export interface Facets {
	models: Array<{ provider: string; model: string }>;
	tools: string[];
	projects: string[];
}

export interface SessionPage {
	sessions: Array<{ id: string; project: string; updatedAt: string }>;
	hasMore: boolean;
}

export interface CallRow {
	id: number;
	timestamp: string;
	provider: string;
	model: string;
	tool: string;
	scope: "direct" | "nested" | "model";
	outcome: Outcome;
	exitCode: number | null;
	signature: string;
	preview: string;
	project: string;
}

export interface CallPage {
	rows: CallRow[];
	nextCursor: number | null;
}

export interface CallDetail {
	call: CallRow;
	arguments: string;
	result: string;
	path: string;
	line: number;
	sessionId: string;
	callId: string;
	parentCallId: string | null;
	context: Array<{
		line: number;
		role: string;
		timestamp: string;
		text: string;
	}>;
	notes: string[];
	observations: Array<{
		callId: string;
		source: string;
		durationMs: number | null;
		arguments: string;
		result: string;
	}>;
}
