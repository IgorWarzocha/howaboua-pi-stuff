import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
	EXECUTION_MODE_SESSION_ENTRY,
	resolveExecutionMode,
} from "../src/adapter/activation/execution-mode.ts";

test("execution mode resolves branch override before trusted project default", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-execution-mode-"));
	try {
		mkdirSync(join(cwd, CONFIG_DIR_NAME));
		writeFileSync(join(cwd, CONFIG_DIR_NAME, "pi-codex-conversion.json"), JSON.stringify({ executionMode: "notebook" }));
		const branch = [{
			type: "custom",
			customType: EXECUTION_MODE_SESSION_ENTRY,
			data: { mode: "normal" },
		}];
		const trusted = resolveExecutionMode({
			cwd,
			isProjectTrusted: () => true,
			sessionManager: { getBranch: () => branch },
		} as never);
		assert.deepEqual(trusted, { session: "normal", project: "notebook", effective: "normal" });

		branch.length = 0;
		assert.deepEqual(resolveExecutionMode({
			cwd,
			isProjectTrusted: () => true,
			sessionManager: { getBranch: () => branch },
		} as never), { session: "inherited", project: "notebook", effective: "notebook" });
		assert.deepEqual(resolveExecutionMode({
			cwd,
			isProjectTrusted: () => false,
			sessionManager: { getBranch: () => branch },
		} as never), { session: "inherited" });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
