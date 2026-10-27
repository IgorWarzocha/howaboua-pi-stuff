import type { GrokSessionCallbacks } from "../session.ts";
import { record, textField } from "./wire.ts";

/** Deduplicates provider calls and owns in-flight local tools and their receipts. */
export class GrokSessionTools {
	private readonly calls = new Set<string>();
	private pendingTools = 0;
	webSearch = false;
	private readonly callbacks: GrokSessionCallbacks;
	private readonly acceptsResponse: (id: string | undefined) => boolean;
	private readonly isClosed: () => boolean;
	private readonly send: (event: unknown) => void;
	private readonly onFailure: (error: Error) => void;
	private readonly onEnding: () => void;
	private readonly onReceipt: (quiet: boolean) => void;
	constructor(
		callbacks: GrokSessionCallbacks,
		acceptsResponse: (id: string | undefined) => boolean,
		isClosed: () => boolean,
		send: (event: unknown) => void,
		onFailure: (error: Error) => void,
		onEnding: () => void,
		onReceipt: (quiet: boolean) => void,
	) {
		this.callbacks = callbacks;
		this.acceptsResponse = acceptsResponse;
		this.isClosed = isClosed;
		this.send = send;
		this.onFailure = onFailure;
		this.onEnding = onEnding;
		this.onReceipt = onReceipt;
	}
	get pending(): number {
		return this.pendingTools;
	}
	async receive(event: Record<string, unknown>): Promise<void> {
		const responseId = textField(event, "response_id");
		if (!this.acceptsResponse(responseId)) return;
		const callId = textField(event, "call_id");
		if (!callId) {
			this.onFailure(new Error("Grok returned an invalid tool call ID"));
			return;
		}
		if (this.calls.has(callId)) return;
		this.calls.add(callId);
		// xAI reports native searches through function-call events too. These
		// are observations, not requests for a local result or continuation.
		if (this.webSearch && event["name"] === "web_search") {
			try {
				const args = record(JSON.parse(textField(event, "arguments") ?? "{}"));
				this.callbacks.nativeTool?.(callId, "web_search", args);
			} catch (error) {
				this.callbacks.diagnostic?.({
					type: "native_tool.trace_error",
					call_id: callId,
					message: error instanceof Error ? error.message : String(error),
				});
			}
			return;
		}
		this.pendingTools++;
		let output: unknown;
		let quiet = false;
		try {
			const argumentsText = textField(event, "arguments");
			if (!argumentsText) throw new Error("Invalid task arguments");
			const args = record(JSON.parse(argumentsText));
			if (event["name"] === "end_the_call") {
				if (Object.keys(args).length)
					throw new Error("End call takes no arguments");
				this.onEnding();
				output = { hangUp: true };
			} else if (event["name"] === "stay_quiet") {
				if (Object.keys(args).length)
					throw new Error("Stay quiet takes no arguments");
				quiet = true;
				output = { quiet: true };
			} else if (event["name"] === "send_task") {
				const request = textField(args, "request")?.trim();
				if (!request || Object.keys(args).some((key) => key !== "request"))
					throw new Error("Task must contain a nonempty request");
				this.callbacks.task(callId, request);
				output = { accepted: true, task_id: callId };
			} else {
				const name = textField(event, "name");
				if (!name || !this.callbacks.executeTool)
					throw new Error("Unknown voice tool");
				output = await this.callbacks.executeTool(name, args, callId);
			}
		} catch (error) {
			output = {
				error:
					error instanceof Error ? error.message : "Task could not be accepted",
			};
		}
		this.pendingTools--;
		if (this.isClosed()) return;
		this.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: callId,
				output: JSON.stringify(output),
			},
		});
		this.onReceipt(quiet);
	}
}
