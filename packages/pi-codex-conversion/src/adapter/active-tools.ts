import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tool } from "@earendil-works/pi-ai";
import { CODE_MODE_EXEC_CONSTRAINED_SAMPLING } from "../tools/code-mode/exec-contract.ts";

export function getActiveToolsInActiveOrder(
	pi: Pick<ExtensionAPI, "getActiveTools" | "getAllTools">,
	codeMode = false,
): Tool[] {
	const toolsByName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
	return pi.getActiveTools().flatMap((name): Tool[] => {
		const tool = toolsByName.get(name);
		if (!tool) return [];
		return [{
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(codeMode && tool.name === "exec" ? { constrainedSampling: CODE_MODE_EXEC_CONSTRAINED_SAMPLING } : {}),
		}];
	});
}
