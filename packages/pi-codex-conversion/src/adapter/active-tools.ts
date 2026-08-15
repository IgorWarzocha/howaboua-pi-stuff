import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tool } from "@earendil-works/pi-ai";
import { CODE_MODE_EXEC_CONSTRAINED_SAMPLING } from "../tools/code-mode/exec-contract.ts";
import { getExperimentalToolSampling } from "../tools/tool-sampling.ts";

export function getActiveToolsInActiveOrder(
	pi: Pick<ExtensionAPI, "getActiveTools" | "getAllTools">,
	codeMode = false,
): Tool[] {
	const toolsByName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
	return pi.getActiveTools().flatMap((name): Tool[] => {
		const tool = toolsByName.get(name);
		if (!tool) return [];
		const constrainedSampling = codeMode && tool.name === "exec"
			? CODE_MODE_EXEC_CONSTRAINED_SAMPLING
			: getExperimentalToolSampling(tool.name);
		return [{
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(constrainedSampling ? { constrainedSampling } : {}),
		}];
	});
}
