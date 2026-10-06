import { join } from "node:path";
import { pathToFileURL } from "node:url";

const agentDir = process.env.PI_CODING_AGENT_DIR;
if (!agentDir) throw new Error("PI_CODING_AGENT_DIR required");
const packagePath = process.argv[2];
if (!packagePath) throw new Error("Installed conversion package path required");
const extension = join(packagePath, "dist");
const { ensureCodeModeHostBinary } = await import(
	pathToFileURL(join(extension, "tools/code-mode/binary.js")).href
);
const { ensureNotebookDenoBinary } = await import(
	pathToFileURL(join(extension, "tools/notebook-mode/deno-binary.js")).href
);
await ensureCodeModeHostBinary();
await ensureNotebookDenoBinary({ agentDir });
