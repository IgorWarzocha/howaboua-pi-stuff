import type { ConstrainedSamplingConfig } from "@earendil-works/pi-ai";

const PREFER_STRICT_TOOL_SAMPLING = {
	type: "json_schema",
	strict: "prefer",
} as const satisfies ConstrainedSamplingConfig;

const STRICT_NORMAL_MODE_TOOLS = new Set(["exec_command", "apply_patch"]);

export function getExperimentalToolSampling(
	toolName: string,
): ConstrainedSamplingConfig | undefined {
	return process.env["PI_EXPERIMENTAL"] === "1" && STRICT_NORMAL_MODE_TOOLS.has(toolName)
		? PREFER_STRICT_TOOL_SAMPLING
		: undefined;
}
