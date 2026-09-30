import type { ExtensionAPI, ToolLoadout, ToolLoadoutChanges } from "@earendil-works/pi-coding-agent";
import { missingMcpToolMessage } from "../../tools/code-mode/mcp-tool-recovery.ts";
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
					const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
					// Pi's missing-tool outcome has no MCP payload. Server errors retain their result contract.
					if (outcome.isError && result.structuredContent === undefined && text === `Tool ${tool.name} not found`) {
						const message = missingMcpToolMessage(tool.name, [], loadout.getNamespace(tool.name)?.name);
						if (message) {
							context.captureResult?.({ ...result, content: [{ type: "text", text: message }] });
							throw new Error(message);
						}
					}
					context.captureResult?.(result);
					// Pi keeps the complete MCP CallToolResult here, including images,
					// structured payloads and server-reported isError results.
					if (result.structuredContent !== undefined) return result.structuredContent;
					if (outcome.isError) throw new Error(text || `MCP tool ${tool.name} failed`);
					return result.content.some((block) => block.type !== "text") ? { content: result.content } : text;
				},
			}));
			return { hiddenDeclarations: tools.map((tool) => tool.name) };
		},
	};
}
