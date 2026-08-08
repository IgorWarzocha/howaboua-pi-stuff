import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NotebookCodeModeClient } from "../src/tools/notebook-mode/client.ts";

const root = mkdtempSync(join(tmpdir(), "pi-notebook-platform-"));
const project = join(root, "project");
const agentDir = join(root, "agent");
mkdirSync(join(project, ".git"), { recursive: true });

const context = {
	cwd: project,
	sessionManager: {
		getBranch: () => [],
		getSessionId: () => "platform-smoke",
	},
	ui: { notify() {} },
} as unknown as ExtensionContext;
const toolContext = { cwd: project, extensionContext: context };
const client = new NotebookCodeModeClient({ maxHeapMiB: 256, agentDir });

try {
	const first = await client.execute("let platformProbe: number = 40;", toolContext);
	if (first.kind !== "result" || first.errorText) throw new Error(`First notebook cell failed: ${first.errorText ?? first.kind}`);
	const second = await client.execute([
		"platformProbe += 2;",
		"if (platformProbe !== 42) throw new Error('notebook state did not persist');",
		"const platformTypeError: number = 'bad';",
	].join("\n"), toolContext);
	if (second.kind !== "result" || second.errorText) throw new Error(`Second notebook cell failed: ${second.errorText ?? second.kind}`);
	const diagnostics = await client.controlNotebook({ action: "diagnostics" }, toolContext);
	if (!diagnostics.message.includes("Type 'string' is not assignable to type 'number'")) {
		throw new Error(`Deno LSP did not diagnose the saved notebook:\n${diagnostics.message}`);
	}
	await client.controlNotebook({ action: "reset" }, toolContext);
	const status = await client.controlNotebook({ action: "status", query: "platformProbe" }, toolContext);
	if (!status.message.includes("- none")) throw new Error(`Notebook reset retained state:\n${status.message}`);
	console.log(`Notebook platform smoke passed on ${process.platform}-${process.arch}`);
} finally {
	await client.shutdown();
	rmSync(root, { recursive: true, force: true });
}
