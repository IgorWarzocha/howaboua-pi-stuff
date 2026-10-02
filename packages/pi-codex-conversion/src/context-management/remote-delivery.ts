import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { boundedCodeModeContent } from "../tools/code-mode/tool-result.ts";
import { normalizeResponsesId } from "../providers/openai-responses/shared.ts";
import type { RuntimeResponse } from "../tools/code-mode/types.ts";
import { validateRemoteScope } from "./remote-scope.ts";
import { REMOTE_DELIVERY_MESSAGE, REMOTE_DELIVERY_RECEIVER } from "./remote-delivery-protocol.ts";
export { REMOTE_DELIVERY_MESSAGE, REMOTE_DELIVERY_RECEIVER } from "./remote-delivery-protocol.ts";

const LEGACY_SCHEMA = Type.Object({
	protocol: Type.Literal(1), origin: Type.Literal("host"),
	id: Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }),
	sourceCallId: Type.String({ minLength: 1 }), cellId: Type.String({ minLength: 1 }),
	scope: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("yielded"), Type.Literal("result"), Type.Literal("terminated")]),
	errorText: Type.Optional(Type.String()), contextNotesSaved: Type.Optional(Type.Boolean()),
	outputs: Type.Array(Type.Object({ resultId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }),
		encryptedOutput: Type.String({ minLength: 1 }) }, { additionalProperties: false }), { maxItems: 32 }),
	imageNotice: Type.Optional(Type.String()),
	images: Type.Array(Type.Object({ type: Type.Literal("image"), mimeType: Type.String(), data: Type.String(),
		detail: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("high"), Type.Literal("original")])) },
		{ additionalProperties: false }), { maxItems: 4 }),
}, { additionalProperties: false });
const SCHEMA = Type.Union([LEGACY_SCHEMA, Type.Object({ ...LEGACY_SCHEMA.properties,
	protocol: Type.Literal(2), originalExecCallId: Type.String({ minLength: 1 }),
}, { additionalProperties: false })]);
export type RemoteDelivery = Static<typeof SCHEMA>;

export function readRemoteDelivery(input: unknown): RemoteDelivery {
	if (!Check(SCHEMA, input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 32 * 1024 * 1024 ||
		(!input.outputs.length && input.contextNotesSaved === undefined) ||
		new Set(input.outputs.map(output => output.resultId)).size !== input.outputs.length ||
		input.images.reduce((sum, image) => sum + image.data.length, 0) > 16 * 1024 * 1024 ||
		(input.contextNotesSaved === true && (input.status !== "result" || Boolean(input.errorText))))
		throw new Error("Invalid persisted Remote delivery");
	return input;
}

export function appendRemoteDelivery(pi: ExtensionAPI, response: RuntimeResponse, sourceCallId: string, scope: string, ctx: ExtensionContext): string {
	if (!response.originalExecCallId || !ctx.sessionManager.buildSessionProjection().messages.some(message => message.role === "assistant" &&
		message.content.some(part => part.type === "toolCall" && part.name === "exec" && part.id === response.originalExecCallId)))
		throw new Error("Remote operation executed but its original exec was removed; verify its state before repeating a write");
	const content = boundedCodeModeContent(response.contentItems.filter(item => item.type === "input_image"));
	let details: RemoteDelivery;
	try { details = readRemoteDelivery({
		protocol: 2, origin: "host", id: crypto.randomUUID(), sourceCallId, originalExecCallId: response.originalExecCallId,
		cellId: response.cellId, scope,
		status: response.kind, outputs: response.opaqueOutputs ?? [],
		images: content.filter(item => item.type === "image"),
		...(content.some(item => item.type === "text") ? { imageNotice: content.filter(item => item.type === "text").map(item => item.text).join("\n") } : {}),
		...(response.kind === "result" && response.errorText ? { errorText: response.errorText } : {}),
		...(response.contextNotesSaved === undefined ? {} : { contextNotesSaved: response.contextNotesSaved }),
	}); } catch {
		throw new Error("Remote operation executed but delivery exceeded its bounds; verify note state before repeating a write");
	}
	// Pi flushes this new host record after the current batch's real tool results.
	pi.sendMessage({ customType: REMOTE_DELIVERY_MESSAGE, content: "Remote results", display: false, details },
		{ triggerTurn: false });
	return details.id;
}

export function remoteDeliveryItems(delivery: RemoteDelivery, blockImages = false): unknown[] {
	if (delivery.protocol === 2) {
		// Completion-only events prove the note ledger without fabricating a second receipt.
		if (!delivery.outputs.length) return [];
		const legacyOutput = remoteDeliveryItems({ ...delivery, protocol: 1 }, blockImages)[1] as { output: unknown };
		return [{ type: "function_call_output", call_id: normalizeResponsesId(delivery.originalExecCallId.split("|")[0] ?? ""),
			output: legacyOutput.output }];
	}
	const callId = "host_delivery_" + delivery.id.replaceAll("-", "");
	return [{
		type: "function_call", id: "fc_" + callId, call_id: callId, name: REMOTE_DELIVERY_RECEIVER,
		arguments: JSON.stringify({ origin: "host", source_call_id: delivery.sourceCallId, cell_id: delivery.cellId }),
	}, {
		type: "function_call_output", call_id: callId,
		output: [
			{ type: "input_text", text: delivery.errorText ? "Script error: " + delivery.errorText :
				delivery.status === "terminated" ? "Script terminated; completed Remote results" : "Remote results" },
			...delivery.outputs.flatMap(output => [
				{ type: "input_text", text: "Result " + output.resultId + " (" + output.name + ")" },
				{ type: "encrypted_content", encrypted_content: output.encryptedOutput },
			]),
			...(delivery.imageNotice ? [{ type: "input_text", text: delivery.imageNotice }] : []),
			...(blockImages && delivery.images.length ? [{ type: "input_text", text: "Image reading is disabled." }] :
				delivery.images.map(image => ({ type: "input_image", detail: image.detail ?? "high", image_url: "data:" + image.mimeType + ";base64," + image.data }))),
		],
	}];
}

export function validateRemoteDelivery(delivery: RemoteDelivery, account: () => string | undefined, ctx?: ExtensionContext, baseUrl?: string): void {
	validateRemoteScope(delivery.scope, account, ctx, baseUrl);
}

/** Resolve the source on the event's canonical ancestry, including compacted-out records. */
export function remoteDeliverySource(delivery: RemoteDelivery, ctx: {
	sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries" | "getBranch">;
}) {
	const events = ctx.sessionManager.getEntries().filter(entry => entry.type === "custom_message" &&
		entry.customType === REMOTE_DELIVERY_MESSAGE && entry.details && typeof entry.details === "object" &&
		"id" in entry.details && entry.details.id === delivery.id);
	const event = events[0];
	if (events.length !== 1 || event?.type !== "custom_message" ||
		JSON.stringify(readRemoteDelivery(event.details)) !== JSON.stringify(delivery))
		throw new Error("Remote delivery is missing its canonical provenance");
	const branch = ctx.sessionManager.getBranch(event.id);
	const resultIndex = branch.findLastIndex(entry => entry.type === "message" && entry.message.role === "toolResult" &&
		entry.message.toolCallId === delivery.sourceCallId);
	const result = branch[resultIndex];
	if (result?.type !== "message" || result.message.role !== "toolResult" ||
		(result.message.toolName !== "exec" && result.message.toolName !== "wait"))
		throw new Error("Remote delivery is missing its original exec or wait result");
	const details = result.message.details;
	if (!details || typeof details !== "object" || !("codeMode" in details) || details["codeMode"] !== true ||
		!("opaqueDeliveryId" in details) || details["opaqueDeliveryId"] !== delivery.id ||
		!("cellId" in details) || details["cellId"] !== delivery.cellId ||
		!("status" in details) || details["status"] !== delivery.status ||
		("contextNotesSaved" in details ? details["contextNotesSaved"] : undefined) !== delivery.contextNotesSaved ||
		(delivery.contextNotesSaved !== undefined && (!("contextNotesSource" in details) || details["contextNotesSource"] !== "remote")) ||
		(delivery.errorText ? !("scriptError" in details) || typeof details["scriptError"] !== "string" ||
			!details["scriptError"].startsWith(delivery.errorText) : "scriptError" in details))
		throw new Error("Remote delivery does not match its original result");
	const toolName = result.message.toolName;
	const source = branch.slice(0, resultIndex).findLast(entry => entry.type === "message" && entry.message.role === "assistant" &&
		entry.message.content.some(part => part.type === "toolCall" && part.id === delivery.sourceCallId && part.name === toolName));
	if (!source) throw new Error("Remote delivery is missing its original exec or wait call");
	if (delivery.protocol === 2) {
		const originalIndex = branch.slice(0, resultIndex).findLastIndex(entry => entry.type === "message" && entry.message.role === "assistant" &&
			entry.message.content.some(part => part.type === "toolCall" && part.id === delivery.originalExecCallId && part.name === "exec"));
		if (originalIndex < 0 || (toolName === "exec" && delivery.originalExecCallId !== delivery.sourceCallId))
			throw new Error("Remote delivery is missing its original outer exec");
		if (toolName === "wait" && !branch.slice(originalIndex + 1, resultIndex).some(entry => entry.type === "message" &&
			entry.message.role === "toolResult" && entry.message.toolCallId === delivery.originalExecCallId && entry.message.toolName === "exec" &&
			entry.message.details && typeof entry.message.details === "object" && "codeMode" in entry.message.details &&
			entry.message.details["codeMode"] === true && "cellId" in entry.message.details && entry.message.details["cellId"] === delivery.cellId))
			throw new Error("Remote wait does not descend from its original exec cell");
	}
	return toolName;
}
