import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCodexDeveloperMessageDetails, type CodexDeveloperMessageDetails } from "../../developer-messages.ts";
import { isContextWindowBoundary } from "../../context-management/messages.ts";
import { formatCodeModeToolHelp, isDeferredDiscoverableTool } from "../../tools/code-mode/custom-tool-prompt.ts";
import { codeModeGlobalName } from "../../tools/code-mode/tool-identity.ts";
import type { CodeModeToolDefinition } from "../../tools/code-mode/types.ts";

export const CODEX_TOOLKIT_UPDATE_TYPE = "codex-toolkit-update";

interface ToolkitTool {
	name: string;
	description: string;
	contract: string;
	namespace: string;
}

interface ToolkitUpdate extends CodexDeveloperMessageDetails {
	rootId: string;
	compactionId: string | null;
	content: string;
	tools: ToolkitTool[];
	namespaces: Record<string, string>;
}

export function readToolkitUpdate(value: unknown): ToolkitUpdate {
	if (!isCodexDeveloperMessageDetails(value)
		|| !("rootId" in value) || typeof value.rootId !== "string"
		|| !("compactionId" in value) || (value.compactionId !== null && typeof value.compactionId !== "string")
		|| !("content" in value) || typeof value.content !== "string"
		|| !("tools" in value) || !Array.isArray(value.tools)
		|| !value.tools.every((tool: unknown) => tool && typeof tool === "object"
			&& ["name", "description", "contract", "namespace"].every((key) => typeof (tool as Record<string, unknown>)[key] === "string"))
		|| !("namespaces" in value) || !value.namespaces || typeof value.namespaces !== "object"
		|| Array.isArray(value.namespaces) || !Object.values(value.namespaces).every((description) => typeof description === "string"))
		throw new Error("Malformed persisted toolkit update");
	return value as ToolkitUpdate;
}

export function projectToolkitUpdate(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_TOOLKIT_UPDATE_TYPE) return entry;
	const update = readToolkitUpdate(entry.data);
	return { ...entry, type: "custom_message", content: update.content, display: false, details: update };
}

/** Record only at inference admission, after tool preparation. No queued turn or history rewrite. */
export function recordCodeModeToolkit(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "sessionManager">,
	messages: readonly AgentMessage[],
	catalog: readonly CodeModeToolDefinition[],
): boolean {
	const visible = messages.slice(messages.findLastIndex(isContextWindowBoundary) + 1)
		.flatMap((message) => message.role === "custom" && message.customType === CODEX_TOOLKIT_UPDATE_TYPE
			? [readToolkitUpdate(message.details)] : []);
	const compactionId = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "compaction")?.id ?? null;
	const latest = visible.at(-1);
	const previous = latest?.compactionId === compactionId && visible.some((update) => update.id === latest.rootId)
		? latest : undefined;
	const discoverable = catalog.filter(isDeferredDiscoverableTool);
	const tools: ToolkitTool[] = discoverable.map((tool) => ({
		name: codeModeGlobalName(tool.name),
		description: excerpt(`${"disabledReason" in tool && tool.disabledReason ? "Disabled: " : ""}${tool.description || tool.promptSnippet || tool.usage}`),
		contract: createHash("sha256").update(formatCodeModeToolHelp(tool)).digest("hex"),
		namespace: tool.namespace?.name ?? "",
	})).sort((left, right) => left.name.localeCompare(right.name));
	const namespaces = Object.fromEntries(discoverable.flatMap((tool) => tool.namespace
		? [[tool.namespace.name, tool.namespace.description?.trim() ?? ""]] : []).sort(([left], [right]) => left!.localeCompare(right!)));
	if (previous && JSON.stringify([previous.tools, previous.namespaces]) === JSON.stringify([tools, namespaces])) return false;
	if (!previous && tools.length === 0) return false;
	const oldTools = new Map(previous?.tools.map((tool) => [tool.name, tool]));
	const added = tools.filter((tool) => !oldTools.has(tool.name));
	const changed = tools.filter((tool) => oldTools.has(tool.name) && JSON.stringify(tool) !== JSON.stringify(oldTools.get(tool.name)));
	const removed = previous?.tools.filter((tool) => !tools.some((current) => current.name === tool.name)) ?? [];
	const instructions = Object.entries(namespaces).filter(([name, description]) => !previous || previous.namespaces[name] !== description)
		.map(([name, description]) => `${name}${description ? `\n${description}` : ""}`);
	const content = [
		previous ? "Toolkit update" : "Deferred tools — full help in ALL_TOOLS",
		...instructions,
		...(!previous ? toolLines(tools) : [
			...(added.length ? ["Added:", ...toolLines(added)] : []),
			...(changed.length ? ["Changed:", ...toolLines(changed)] : []),
			...(removed.length ? [`Removed: ${removed.map((tool) => tool.name).join(", ")}`] : []),
		]),
	].join("\n");
	const id = randomUUID();
	pi.appendEntry(CODEX_TOOLKIT_UPDATE_TYPE, {
		protocol: 1, id, rootId: previous?.rootId ?? id, compactionId, content, tools, namespaces,
	} satisfies ToolkitUpdate);
	return true;
}

function excerpt(description: string): string {
	const line = description.replace(/\s+/g, " ").trim();
	return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

function toolLines(tools: ToolkitTool[]): string[] {
	return tools.map((tool) => `- ${tool.name}: ${tool.description}`);
}
