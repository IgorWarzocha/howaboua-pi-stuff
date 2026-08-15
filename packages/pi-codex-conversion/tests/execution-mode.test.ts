import assert from "node:assert/strict";
import test from "node:test";
import { EXECUTION_MODE_SESSION_ENTRY } from "../src/adapter/activation/execution-mode.ts";
import { isProviderContextExcludedMessage } from "../src/adapter/prompt/context-filter.ts";
import { NOTEBOOK_TREE_EPOCH_ENTRY } from "../src/tools/notebook-mode/session-identity.ts";

test("legacy execution-mode entries stay out of provider context", () => {
	for (const customType of [EXECUTION_MODE_SESSION_ENTRY, NOTEBOOK_TREE_EPOCH_ENTRY]) {
		assert.equal(isProviderContextExcludedMessage({ role: "custom", customType }), true);
	}
});
