import type { ExtensionAPI, ToolLoadout, ToolLoadoutChanges } from "@earendil-works/pi-coding-agent";
import type { ProgrammaticCodeModeToolDefinition } from "../../tools/code-mode/types.ts";

/** Admission belongs to Pi's MCP owner, not a name prefix or a generic extension sweep. */
export function createMcpCodeModeBridge(pi: ExtensionAPI): {
	prepareLoadout(loadout: ToolLoadout): ToolLoadoutChanges;
	getTools(): ProgrammaticCodeModeToolDefinition[];
} {
	let tools: ProgrammaticCodeModeToolDefinition[] = [];
	return {
		getTools: () => tools,
		prepareLoadout(loadout) {
			const owned = new Map(pi.getAllTools()
				.filter((tool) => tool.sourceInfo?.path === "builtin:mcp")
				.map((tool) => [tool.name, tool]));
			tools = loadout.callable.filter((tool) => owned.has(tool.name)).map((tool) => ({
				name: tool.name,
				usage: `await tools.${tool.name}(args)`,
				description: tool.description,
				namespace: loadout.getNamespace(tool.name),
				annotations: owned.get(tool.name)?.annotations,
				kind: "function",
				deferLoading: true,
				discoverWhenDeferred: true,
				executionPipeline: "pi",
				inputSchema: tool.parameters,
				output: tool.outputSchema ? JSON.stringify(tool.outputSchema) : undefined,
				async invoke(input, context, signal) {
					if (!context.executeTool) throw new Error("Pi nested tool executor is unavailable");
					const outcome = await context.executeTool(tool.name, input, { signal, ...(context.onUpdate ? { onUpdate: context.onUpdate } : {}) });
					const { result } = outcome;
					context.captureResult?.(result);
					// Pi keeps the complete MCP CallToolResult here, including images,
					// structured payloads and server-reported isError results.
					if (result.structuredContent !== undefined) return result.structuredContent;
					const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
					if (outcome.isError) throw new Error(text || `MCP tool ${tool.name} failed`);
					return result.content.some((block) => block.type !== "text") ? { content: result.content } : text;
				},
			}));
			return { hiddenDeclarations: tools.map((tool) => tool.name) };
		},
	};
}
