import type { ExtensionAPI, ToolLoadout, ToolLoadoutChanges } from "@earendil-works/pi-coding-agent";
import { missingMcpToolMessage } from "../../tools/code-mode/mcp-tool-recovery.ts";
import type { ProgrammaticCodeModeToolDefinition } from "../../tools/code-mode/types.ts";
import { ALL_CODEX_ADAPTER_TOOL_NAMES } from "../activation/runtime-plan.ts";

/** Pi owns callable admission; explicit integrations reserve their native names. */
export function createPiCodeModeBridge(pi: ExtensionAPI): {
	prepareLoadout(loadout: ToolLoadout): ToolLoadoutChanges;
	getTools(reservedNames?: readonly string[]): ProgrammaticCodeModeToolDefinition[];
} {
	let tools: ProgrammaticCodeModeToolDefinition[] = [];
	return {
		getTools: (reservedNames = []) => tools.filter((tool) => !reservedNames.includes(tool.name)),
		prepareLoadout(loadout) {
			const registered = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
			tools = loadout.callable.filter((tool) => tool.name !== "codemode"
				&& !ALL_CODEX_ADAPTER_TOOL_NAMES.includes(tool.name)
				&& registered.get(tool.name)?.sourceInfo?.path !== "builtin:tool-search").map((tool) => {
				const metadata = registered.get(tool.name);
				const mcp = metadata?.sourceInfo?.path === "builtin:mcp";
				return {
					name: tool.name,
					usage: `await tools.${tool.name}(args)`,
					description: tool.description,
					namespace: loadout.getNamespace(tool.name),
					annotations: metadata?.annotations,
					promptGuidelines: metadata?.promptGuidelines,
					kind: "function",
					deferLoading: true,
					discoverWhenDeferred: true,
					...(mcp ? { discovery: "server" as const } : {}),
					executionPipeline: "pi",
					inputSchema: tool.parameters,
					output: tool.outputSchema ? JSON.stringify(tool.outputSchema) : undefined,
					async invoke(input, context, signal) {
						if (!context.executeTool) throw new Error("Pi nested tool executor is unavailable");
						const outcome = await context.executeTool(tool.name, input, { signal, ...(context.onUpdate ? { onUpdate: context.onUpdate } : {}) });
						const { result } = outcome;
						const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
						// Pi's missing-tool outcome has no MCP payload. Server errors retain their result contract.
						if (mcp && outcome.isError && result.structuredContent === undefined && text === `Tool ${tool.name} not found`) {
							const message = missingMcpToolMessage(tool.name, [], loadout.getNamespace(tool.name)?.name);
							if (message) {
								context.captureResult?.({ ...result, content: [{ type: "text", text: message }] });
								throw new Error(message);
							}
						}
						context.captureResult?.(result);
						// Declared structured output follows Pi's script contract, including
						// structured errors. MCP keeps its complete CallToolResult here.
						if ((mcp || tool.outputSchema) && result.structuredContent !== undefined) return result.structuredContent;
						if (outcome.isError) throw new Error(text || `Tool ${tool.name} failed`);
						return result.content.some((block) => block.type !== "text") ? { content: result.content } : text;
					},
				};
			});
			return { hiddenDeclarations: tools.map((tool) => tool.name) };
		},
	};
}
