import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getBundledApplyPatchBinaryPath(): string | undefined {
	const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
	const exe = process.platform === "win32" ? "apply_patch.exe" : "apply_patch";
	const binary = join(root, "src", "tools", "apply-patch", "bin", `${process.platform}-${process.arch}`, exe);
	return existsSync(binary) ? binary : undefined;
}
