import { getBundledToolBinaryPath } from "../native/binary.ts";

export function getBundledApplyPatchBinaryPath(customDir?: string | undefined): string | undefined {
	return getBundledToolBinaryPath("apply_patch", {}, customDir);
}
