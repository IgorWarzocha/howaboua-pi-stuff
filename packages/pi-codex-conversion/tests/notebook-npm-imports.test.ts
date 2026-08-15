import assert from "node:assert/strict";
import test from "node:test";
import { extractNotebookNpmImports } from "../src/tools/notebook-mode/npm-imports.ts";

test("notebook npm inventory recognizes static JavaScript import literals only", () => {
	const source = [
		"await import(`npm:alpha@1.2.3`);",
		String.raw`await import("npm:bravo@2.0.\x30");`,
		"await import(`npm:${name}@1.0.0`);",
		"// await import('npm:comment@1.0.0');",
	].join("\n");

	assert.deepEqual(extractNotebookNpmImports(source), ["npm:alpha@1.2.3", "npm:bravo@2.0.0"]);
});
