import type { RuntimeResponse, OpaqueToolOutput, RuntimeContentItem, ToolExecutionContext } from "../types.ts";
import type { CodeModeTraceStore } from "../trace-store.ts";

const MAX_NOTIFICATION_CHARS = 16_384;
const MAX_NOTIFICATIONS_PER_CELL = 100;
const MAX_OPAQUE_BYTES = 32 * 1024 * 1024;

interface PendingOpaqueResults {
	outputs: OpaqueToolOutput[];
	images: RuntimeContentItem[];
	bytes: number;
}

export class DelegateCellResults {
	private readonly notifications = new Map<string, string[]>();
	private readonly opaqueResults = new Map<string, PendingOpaqueResults>();
	private readonly originalExecCalls = new Map<string, string>();
	// Continuation routing must survive bounded display traces.
	private readonly execSessions = new Map<string, Set<number>>();
	private readonly terminatingCells = new Set<string>();

	bindCell(cellId: string, context: ToolExecutionContext): void {
		if (context.originalExecCallId && !this.originalExecCalls.has(cellId))
			this.originalExecCalls.set(cellId, context.originalExecCallId);
	}
	originalExecCallId(cellId: string): string | undefined { return this.originalExecCalls.get(cellId); }
	opaqueCellIds(): IterableIterator<string> { return this.opaqueResults.keys(); }
	hasOpaqueResults(cellId: string): boolean { return this.opaqueResults.has(cellId); }
	clearOpaqueResults(): void { this.opaqueResults.clear(); }
	markTerminating(cellId: string): void { this.terminatingCells.add(cellId); }
	delete(cellId: string): void {
		this.notifications.delete(cellId);
		this.opaqueResults.delete(cellId);
		this.originalExecCalls.delete(cellId);
		this.execSessions.delete(cellId);
		this.terminatingCells.delete(cellId);
	}
	clear(): void {
		this.originalExecCalls.clear();
		this.notifications.clear();
		this.clearOpaqueResults();
		this.execSessions.clear();
		this.terminatingCells.clear();
	}
	captureOpaqueResult(cellId: string, output: OpaqueToolOutput, images: RuntimeContentItem[]): void {
		const pending = this.opaqueResults.get(cellId)!;
		const bytes = Buffer.byteLength(output.encryptedOutput, "utf8") + images.reduce((sum, image) => sum + (image.image_url?.length ?? 0), 0);
		const total = [...this.opaqueResults.values()].reduce((sum, entry) => sum + entry.bytes, 0);
		if (total + bytes > MAX_OPAQUE_BYTES)
			throw new Error("Remote operation executed but result capacity was exceeded; check completed results before retrying");
		pending.bytes += bytes;
		pending.outputs.push(output);
		pending.images.push(...images);
	}

	notifyDirect(cellId: string, value: string, context: ToolExecutionContext | undefined): void {
		if (!context) throw new Error("Code-mode notification cell is unavailable");
		const notifications = this.notifications.get(cellId) ?? [];
		const text = value.slice(0, MAX_NOTIFICATION_CHARS);
		notifications.push(text);
		if (notifications.length > MAX_NOTIFICATIONS_PER_CELL)
			notifications.splice(0, notifications.length - MAX_NOTIFICATIONS_PER_CELL);
		this.notifications.set(cellId, notifications);
		context.onUpdate?.({
			content: [{ type: "text", text }],
			details: { cellId, notification: true },
		});
	}

	attach(response: RuntimeResponse, traces: CodeModeTraceStore): RuntimeResponse {
		const originalExecCallId = this.originalExecCalls.get(response.cellId);
		if (response.kind !== "yielded") this.originalExecCalls.delete(response.cellId);
		const notifications = this.notifications.get(response.cellId) ?? [];
		this.notifications.delete(response.cellId);
		const opaque = this.opaqueResults.get(response.cellId);
		const opaqueOutputs = opaque?.outputs;
		const opaqueImages = opaque?.images;
		if (opaque) {
			if (response.kind === "yielded") {
				opaque.outputs = [];
				opaque.images = [];
				opaque.bytes = 0;
			} else {
				this.opaqueResults.delete(response.cellId);
			}
		}
		const execSessionIds = [...(this.execSessions.get(response.cellId) ?? [])];
		if (response.kind !== "yielded") this.execSessions.delete(response.cellId);
		const terminate = response.kind === "result" && !response.errorText && this.terminatingCells.has(response.cellId);
		if (response.kind !== "yielded") this.terminatingCells.delete(response.cellId);
		const withTraces = traces.attach(response);
		return {
			...withTraces,
			...(originalExecCallId ? { originalExecCallId } : {}),
			...(opaqueOutputs?.length ? { opaqueOutputs } : {}),
			...(terminate ? { terminate: true as const } : {}),
			...(execSessionIds.length > 0 ? { execSessionIds } : {}),
			contentItems: [
				...notifications.map((text) => ({ type: "input_text" as const, text })),
				...response.contentItems,
				...(opaqueImages ?? []),
			],
		};
	}
	recordExecSession(cellId: string, toolName: string, input: unknown, resultSessionId: number | undefined): void {
		if (toolName !== "exec_command" && toolName !== "write_stdin") return;
		const sessions = this.execSessions.get(cellId) ?? new Set<number>();
		const inputSessionId = numericSessionId(input);
		if (toolName === "write_stdin" && inputSessionId !== undefined) sessions.delete(inputSessionId);
		if (resultSessionId !== undefined) sessions.add(resultSessionId);
		if (sessions.size > 0) this.execSessions.set(cellId, sessions);
		else this.execSessions.delete(cellId);
	}

	reserveOpaqueCall(cellId: string): void {
		const pending: PendingOpaqueResults = this.opaqueResults.get(cellId) ?? { outputs: [], images: [], bytes: 0 };
		if (!this.opaqueResults.has(cellId) && this.opaqueResults.size >= 32)
			throw new Error("Remote batch capacity reached; finish pending cells, then start a new exec cell");
		this.opaqueResults.set(cellId, pending);
	}
}

export function numericSessionId(value: unknown): number | undefined {
	return value && typeof value === "object" && "session_id" in value && typeof value.session_id === "number"
		? value.session_id
		: undefined;
}
