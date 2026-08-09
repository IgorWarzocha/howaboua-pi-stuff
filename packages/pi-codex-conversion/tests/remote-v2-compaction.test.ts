import test from "node:test";
import assert from "node:assert/strict";
import { buildRemoteCompactionV2Window, normalizeRemoteCompactionV2PromptInput } from "../src/adapter/compaction/remote-v2-history.ts";

test("Responses compaction v2 retains real turns and reconciles tool history", () => {
	const contextual = { role: "user", content: [{ type: "input_text", text: "<environment_context>private scaffolding</environment_context>" }] };
	const real = { role: "user", content: [
		{ type: "input_text", text: "remember this exactly" },
		{ type: "input_text", text: "<hook_prompt hook_run_id=\"injected\">hidden hook</hook_prompt>" },
	] };
	const normalized = normalizeRemoteCompactionV2PromptInput([
		{ type: "function_call_output", call_id: "orphan", output: "drop" },
		{ type: "function_call", id: "fc_pending", call_id: "pending", name: "exec", arguments: "{}" },
		contextual,
		real,
	]);
	const window = buildRemoteCompactionV2Window(normalized, { type: "compaction", encrypted_content: "sealed" });

	assert.deepEqual(normalized[0], { type: "function_call", id: "fc_pending", call_id: "pending", name: "exec", arguments: "{}" });
	assert.deepEqual({ ...normalized[1], id: undefined }, { type: "function_call_output", id: undefined, call_id: "pending", output: "aborted" });
	assert.match(String(normalized[1]?.["id"]), /^fco_/);
	assert.deepEqual(normalizeRemoteCompactionV2PromptInput(normalized), normalized);
	assert.doesNotMatch(JSON.stringify(window), /private scaffolding|hidden hook|orphan/);
	assert.match(JSON.stringify(window), /remember this exactly/);
	assert.equal(window.at(-1)?.["encrypted_content"], "sealed");
});
