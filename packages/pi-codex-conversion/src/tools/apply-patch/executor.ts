import { relative } from "node:path";
import { parsePatchActions } from "../../patch/parser.ts";
import { ExecutePatchError, type ExecutePatchResult } from "../../patch/types.ts";
import { getBundledApplyPatchBinaryPath } from "./binary.ts";
import { parseSingleJsonLine, runBundledTool } from "../path/runner.ts";

interface RustApplyPatchJson {
	status: "success" | "failure";
	error?: string | null | undefined;
	exact?: boolean | undefined;
	result: ExecutePatchResult;
}

function parseRustApplyPatchJson(stdout: string): RustApplyPatchJson {
	const parsed = parseSingleJsonLine<RustApplyPatchJson>(stdout, "apply_patch");
	if (!parsed || typeof parsed !== "object" || !parsed.result) {
		throw new Error("apply_patch returned invalid structured JSON output");
	}
	return parsed;
}

function displayPatchPath(cwd: string, path: string): string {
	if (!path.startsWith("/")) {
		return path;
	}
	const relativePath = relative(cwd, path);
	return relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/") ? relativePath : path;
}

function errorMentionsAction(error: string, action: { path: string; movePath?: string | undefined }): boolean {
	return error.includes(action.path) || (action.movePath ? error.includes(action.movePath) : false);
}

export async function executePatchWithRust({ cwd, patchText, signal }: { cwd: string; patchText: string; signal?: AbortSignal | undefined }): Promise<ExecutePatchResult> {
	const binary = getBundledApplyPatchBinaryPath();
	if (!binary) {
		throw new Error(`apply_patch binary is not bundled for ${process.platform}-${process.arch}`);
	}
	const child = await runBundledTool({
		binary,
		args: [],
		stdin: patchText,
		cwd,
		env: { ...process.env, PI_APPLY_PATCH_JSON: "1" },
		signal,
		label: "apply_patch",
	});
	const parsed = parseRustApplyPatchJson(child.stdout);
	if (parsed.status === "success" && child.status === 0) {
		return parsed.result;
	}

	const result = parsed.result ?? { changedFiles: [], createdFiles: [], deletedFiles: [], movedFiles: [], fuzz: 0 };
	const errorMessage = parsed.error ?? child.stderr ?? "apply_patch failed";
	let parsedActions = [] as ReturnType<typeof parsePatchActions>;
	try {
		parsedActions = parsePatchActions({ text: patchText }).map((action) => ({
			...action,
			path: displayPatchPath(cwd, action.path),
			movePath: action.movePath ? displayPatchPath(cwd, action.movePath) : action.movePath,
		}));
	} catch {
		// Rust already produced the authoritative parse error.
	}
	const failureAction = parsedActions.find((action) => errorMentionsAction(errorMessage, action));
	const failures = failureAction ? [{ action: failureAction, message: errorMessage }] : [];
	throw new ExecutePatchError(parsed.error ?? child.stderr ?? "apply_patch failed", result, failures);
}

