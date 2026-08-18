import assert from "node:assert/strict";
import test from "node:test";
import {
	createEventBus,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { registerApplyPatchDisplay } from "../src/apply-patch-display.ts";
import {
	recordApplyPatchDisplayInput,
	recordApplyPatchDisplayOutcome,
	registerApplyPatchDisplayBroker,
	shouldCompactApplyPatchDisplay,
} from "../src/tools/apply-patch/display-broker.ts";

function displayExtensionApi(bus = createEventBus()) {
	const handlers = new Map<string, Array<(event: never) => unknown>>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	let renderedType: string | undefined;
	const pi = {
		events: { emit: bus.emit, on: bus.on },
		registerEntryRenderer(customType: string) {
			renderedType = customType;
		},
		on(event: string, handler: (event: never) => unknown) {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		entries,
		get renderedType() {
			return renderedType;
		},
		emit(event: string, value: unknown = {}) {
			return (handlers.get(event) ?? []).map((handler) =>
				handler(value as never),
			);
		},
	};
}

test("apply_patch display protocol routes scoped entries after tool results", () => {
	const bus = createEventBus();
	const consumer = displayExtensionApi(bus);
	const registration = registerApplyPatchDisplay(consumer.pi, {
		customType: "test-apply-patch-display",
		render: (() => undefined) as never,
	});
	assert.equal(registration.available, false);
	assert.equal(consumer.renderedType, "test-apply-patch-display");
	const conversion = displayExtensionApi(bus);
	registerApplyPatchDisplayBroker(conversion.pi);
	assert.equal(registration.available, true);

	const details = {
		status: "success" as const,
		result: {
			changedFiles: ["file.ts"],
			createdFiles: [],
			deletedFiles: [],
			movedFiles: [],
			fuzz: 0,
		},
	};
	assert.deepEqual(
		conversion.emit("tool_result", {
			toolName: "apply_patch",
			toolCallId: "direct-1",
			input: { input: "*** Begin Patch\n*** End Patch" },
			content: [{ type: "text", text: "Applied direct" }],
			details,
			isError: false,
		}),
		[undefined],
	);
	const fullInput = `*** Begin Patch\n${"+full patch line\n".repeat(1_100)}*** End Patch`;
	const partialDetails = {
		...details,
		status: "partial_failure" as const,
		failedTargets: ["file.ts"],
	};
	recordApplyPatchDisplayInput("runtime-1:cell-1:tool-1", fullInput);
	recordApplyPatchDisplayOutcome("runtime-1:cell-1:tool-1", {
		content: "Earlier actions were applied",
		details: partialDetails,
		error: "Earlier actions were applied",
		isError: true,
	});
	assert.deepEqual(
		conversion.emit("tool_result", {
			toolName: "exec",
			toolCallId: "exec-1",
			input: {},
			content: [],
			details: {
				codeMode: true,
				traces: [
					{
						id: "runtime-1:cell-1:tool-1",
						name: "apply_patch",
						input: `${fullInput.slice(0, 16_000)}[value truncated]`,
						status: "error",
						error: "Earlier actions were applied",
					},
				],
			},
			isError: false,
		}),
		[undefined],
	);
	const secondNestedId = "runtime-1:cell-2:tool-1";
	const secondNestedInput = "*** Begin Patch\nsecond\n*** End Patch";
	recordApplyPatchDisplayInput(secondNestedId, secondNestedInput);
	recordApplyPatchDisplayOutcome(secondNestedId, {
		content: "Applied again",
		details,
		isError: false,
	});
	assert.deepEqual(
		conversion.emit("tool_result", {
			toolName: "exec",
			toolCallId: "exec-2",
			input: {},
			content: [],
			details: {
				codeMode: true,
				traces: [
					{
						id: secondNestedId,
						name: "apply_patch",
						input: secondNestedInput,
						status: "done",
						result: {
							content: [{ type: "text", text: "Applied again" }],
							details,
						},
					},
				],
			},
			isError: false,
		}),
		[undefined],
	);

	assert.deepEqual(conversion.entries, []);
	conversion.emit("turn_end");
	assert.deepEqual(conversion.entries, [
		{
			customType: "test-apply-patch-display",
			data: {
				toolCallId: "direct-1",
				input: "*** Begin Patch\n*** End Patch",
				details,
				content: "Applied direct",
				isError: false,
				source: "direct",
			},
		},
		{
			customType: "test-apply-patch-display",
			data: {
				toolCallId: "runtime-1:cell-1:tool-1",
				input: fullInput,
				details: partialDetails,
				content: "Earlier actions were applied",
				error: "Earlier actions were applied",
				isError: true,
				source: "nested",
			},
		},
		{
			customType: "test-apply-patch-display",
			data: {
				toolCallId: secondNestedId,
				input: secondNestedInput,
				details,
				content: "Applied again",
				isError: false,
				source: "nested",
			},
		},
	]);

	conversion.emit("tool_result", {
		toolName: "apply_patch",
		toolCallId: "pending-1",
		input: { input: "pending" },
		content: [{ type: "text", text: "Pending" }],
		details,
		isError: false,
	});
	registration.dispose();
	conversion.emit("turn_end");

	const lateConsumer = displayExtensionApi(bus);
	const lateRegistration = registerApplyPatchDisplay(lateConsumer.pi, {
		customType: "late-apply-patch-display",
		render: (() => undefined) as never,
	});
	assert.equal(lateRegistration.available, true);
	assert.equal(shouldCompactApplyPatchDisplay("pending-1", true), false);
	assert.equal(shouldCompactApplyPatchDisplay("direct-1", true), true);
	lateRegistration.dispose();
	conversion.emit("session_shutdown");
	assert.equal(registration.available, false);
});
