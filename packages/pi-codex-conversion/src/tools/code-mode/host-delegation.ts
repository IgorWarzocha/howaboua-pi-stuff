import { CodeModeDelegateRuntime } from "./delegate-runtime.js";
import { executionCellId, type HostMessage } from "./host-protocol.js";
import type {
	CodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "./types.js";

export class CodeModeHostDelegation {
	private readonly runtime: CodeModeDelegateRuntime;

	constructor(send: (message: unknown) => void) {
		this.runtime = new CodeModeDelegateRuntime(send);
	}

	bindResponse(
		value: unknown,
		context?: ToolExecutionContext,
		tools?: Map<string, CodeModeToolDefinition>,
	): void {
		const cellId = executionCellId(value);
		if (cellId && context) this.runtime.bindCell(cellId, context, tools);
	}

	updateCellContext(cellId: string, context: ToolExecutionContext): void {
		this.runtime.updateCellContext(cellId, context);
	}

	isBlocked(cellId: string): boolean {
		return this.runtime.isBlocked(cellId);
	}

	waitUntilUnblocked(cellId: string, signal?: AbortSignal): Promise<void> {
		return this.runtime.waitUntilUnblocked(cellId, signal);
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		return this.runtime.attach(response);
	}

	clear(): void {
		this.runtime.clear();
	}

	handleMessage(message: HostMessage): void {
		if (message.type === "delegate/request") {
			this.runtime.handleRequest(message);
			return;
		}
		if (message.type === "delegate/cancel") {
			this.runtime.cancel(message.id);
			return;
		}
		if (message.type === "cell/closed") this.runtime.closeCell(message.cellId);
	}
}
