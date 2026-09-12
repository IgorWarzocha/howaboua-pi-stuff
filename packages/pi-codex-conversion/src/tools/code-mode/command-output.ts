import { codeModeGlobalName } from "./tool-identity.js";
import type { CodeModeToolDefinition } from "./types.js";

// Inject the same formatter into V8 and Deno without changing returned objects.
export const plainCommandOutputFormatterSource = `(value) => {
  const metadata = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "output"));
  let prefix = "";
  if (Object.keys(metadata).length > 0) {
    try { prefix = JSON.stringify(metadata); } catch { prefix = String(metadata); }
    prefix += "\\n";
  }
  return prefix + "Output:\\n" + value.output;
}`;

export function withPlainCommandOutput(source: string, tools: CodeModeToolDefinition[]): string {
	const names = tools.flatMap((tool) =>
		"textOutput" in tool && tool.textOutput === "plain-command"
			? [codeModeGlobalName(tool.name)]
			: []);
	if (names.length === 0) return source;
	// Keep the injected prefix on one line so cell line numbers do not shift.
	return `(() => {
  const registry = globalThis.tools;
  const emit = globalThis.text;
  const results = new WeakSet();
  const format = ${plainCommandOutputFormatterSource};
  for (const name of ${JSON.stringify(names)}) {
    const invoke = registry[name];
    registry[name] = async (...args) => {
      const value = await invoke.apply(registry, args);
      if (value !== null && typeof value === "object") results.add(value);
      return value;
    };
  }
  globalThis.text = (value) => emit(results.has(value) && typeof value.output === "string" ? format(value) : value);
})();`.replaceAll("\n", "") + source;
}
