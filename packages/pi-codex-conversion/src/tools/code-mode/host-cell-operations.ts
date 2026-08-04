import type { CodeModeHostDelegation } from "./host-delegation.js";
import { operationAbort, throwIfAborted } from "./host-operation.js";
import {
	isMissingRuntimeOutcome,
	parseRuntimeResponse,
	runtimeOutcome,
} from "./host-protocol.js";
import type { CodeModeHostSession } from "./host-session.js";
import type { RuntimeResponse, ToolExecutionContext } from "./types.js";

export class CodeModeHostCellOperations {
	private readonly session: CodeModeHostSession;
	private readonly delegation: CodeModeHostDelegation;

	constructor(
		session: CodeModeHostSession,
		delegation: CodeModeHostDelegation,
	) {
		this.session = session;
		this.delegation = delegation;
	}

	async wait(
		cellId: string,
		yieldTimeMs: number,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		return this.run(
			cellId,
			context,
			signal,
			{
				method: "session/wait",
				sessionId: this.session.id,
				request: { cell_id: cellId, yield_time_ms: yieldTimeMs },
			},
			"Code-mode host returned an invalid wait outcome",
		);
	}

	async terminate(
		cellId: string,
		context: ToolExecutionContext,
		signal?: AbortSignal,
	): Promise<RuntimeResponse> {
		return this.run(
			cellId,
			context,
			signal,
			{
				method: "session/terminate",
				sessionId: this.session.id,
				cellId,
			},
			"Code-mode host returned an invalid termination outcome",
		);
	}

	private async run(
		cellId: string,
		context: ToolExecutionContext,
		signal: AbortSignal | undefined,
		request: Record<string, unknown>,
		invalidOutcomeMessage: string,
	): Promise<RuntimeResponse> {
		throwIfAborted(signal);
		await this.session.start();
		throwIfAborted(signal);
		this.delegation.updateCellContext(cellId, context);
		const id = this.session.nextRequestId();
		const abort = operationAbort(this.session, id);
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await this.session.requestWithId(id, request, (response) =>
				this.delegation.bindResponse(response, context),
			);
			const wrapped = runtimeOutcome(value);
			if (!wrapped) throw new Error(invalidOutcomeMessage);
			return {
				...this.delegation.attach(parseRuntimeResponse(wrapped)),
				...(isMissingRuntimeOutcome(value)
					? { missingCell: true as const }
					: {}),
			};
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}
}
