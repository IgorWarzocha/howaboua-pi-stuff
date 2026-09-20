import { codeModeGlobalName } from "./tool-identity.js";
import type { CodeModeToolDefinition } from "./types.js";

// Inject the same formatter into V8 and Deno without changing returned objects.
export const commandOutputFormatterSource = `(value, plain) => {
  const metadata = Object.fromEntries(Object.entries(value).filter(([key]) =>
    key !== "output" && key !== "chunk_id" && key !== "wall_time_seconds"
    && (key !== "original_token_count" || value.truncated)));
  const projected = plain ? metadata : { output: value.output, ...metadata };
  let text;
  try { text = JSON.stringify(projected); } catch { text = String(projected); }
  return plain ? text + "\\nOutput:\\n" + value.output : text;
}`;

export function withCommandOutput(source: string, tools: CodeModeToolDefinition[]): string {
	const hints = tools.flatMap((tool) =>
		"textOutput" in tool && tool.textOutput !== undefined
			? [[codeModeGlobalName(tool.name), tool.textOutput === "plain-command"]]
			: []);
	if (hints.length === 0) return source;
	// Keep the injected prefix on one line so cell line numbers do not shift.
	return `(() => {
  const registry = globalThis.tools;
  const emit = globalThis.text;
  const results = new WeakMap();
  const format = ${commandOutputFormatterSource};
  for (const [name, plain] of ${JSON.stringify(hints)}) {
    const invoke = registry[name];
    registry[name] = async (...args) => {
      const value = await invoke.apply(registry, args);
      if (value !== null && typeof value === "object") results.set(value, plain);
      return value;
    };
  }
  globalThis.text = (value) => emit(results.has(value) && typeof value.output === "string" ? format(value, results.get(value)) : value);
})();`.replaceAll("\n", "") + source;
}
