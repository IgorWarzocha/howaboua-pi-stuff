import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { parseCustomTool } from "../src/tools/code-mode/custom-tools.ts";

test("custom tool commands distinguish PATH names from relative paths", () => {
	const definitionPath = resolve("definitions/example.toml");
	const relative = parseCustomTool(
		definitionPath,
		'usage = "await tools.example(input)"\ncommand = "scripts/tool.mjs"\n',
	);
	const scriptPath = resolve(dirname(definitionPath), "scripts/tool.mjs");
	assert.equal(relative.command, process.execPath);
	assert.deepEqual(relative.args, [scriptPath]);

	const bare = parseCustomTool(
		definitionPath,
		'usage = "await tools.example(input)"\ncommand = "tool"\n',
	);
	assert.equal(bare.command, "tool");
});
