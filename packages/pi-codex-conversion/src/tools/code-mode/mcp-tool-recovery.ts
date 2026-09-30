import type { CodeModeToolDefinition } from "./types.js";

// Also injected into V8. Keep this function self-contained, with no captured helpers.
export function missingMcpToolMessage(
	name: string,
	namespaces: readonly string[],
	exactNamespace?: string,
): string | undefined {
	if (!exactNamespace && !/^mcp__.+__.+$/.test(name)) return undefined;
	let identity: string;
	if (exactNamespace) {
		identity = `MCP namespace ${JSON.stringify(exactNamespace)}`;
	} else {
		const matches: string[] = [];
		for (const namespace of namespaces) {
			const normalized = namespace.replace(/[^A-Za-z0-9_]/g, "_");
			if (name.startsWith(`${normalized}__`) && !matches.includes(namespace)) matches.push(namespace);
		}
		if (matches.length === 1) {
			identity = `MCP namespace ${JSON.stringify(matches[0])}`;
		} else if (matches.length > 1) {
			identity = `Ambiguous MCP namespace ${JSON.stringify(matches)}; confirm the server`;
		} else {
			const prefix = name.slice(0, name.indexOf("__", 5));
			identity = `MCP namespace prefix ${JSON.stringify(prefix)} inferred from the tool name; normalized names can be ambiguous, so confirm the server`;
		}
	}
	return `Missing MCP tool: ${name}. ${identity}. If that server connects, retry in a new exec cell. If failures repeat, suggest disabling that specific server to the user.`;
}

export function mcpToolNamespaces(tools: Iterable<CodeModeToolDefinition>): string[] {
	return [...new Set([...tools].flatMap((tool) =>
		"executionPipeline" in tool && tool.executionPipeline === "pi" && tool.namespace
			? [tool.namespace.name] : []))];
}

/** The V8 host rejects absent properties before delegation, including caught errors. */
export function withMissingMcpToolRecovery(source: string, tools: CodeModeToolDefinition[]): string {
	return `(() => {
  const message = ${missingMcpToolMessage.toString()};
  const namespaces = ${JSON.stringify(mcpToolNamespaces(tools))};
  globalThis.tools = new Proxy(globalThis.tools, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (value !== undefined || typeof name !== "string") return value;
      const recovery = message(name, namespaces);
      return recovery === undefined ? value : () => { throw new Error(recovery); };
    }
  });
})();`.replaceAll("\n", "") + source;
}
