import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCodexDeveloperMessageDetails, type CodexDeveloperMessageDetails } from "../../developer-messages.ts";
import { isContextWindowBoundary } from "../../context-management/messages.ts";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../../tools/code-mode/custom-tool-prompt.ts";
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
	promptCatalog: readonly CodeModeToolDefinition[] = [],
): boolean {
	const visible = messages.slice(messages.findLastIndex(isContextWindowBoundary) + 1)
		.flatMap((message) => message.role === "custom" && message.customType === CODEX_TOOLKIT_UPDATE_TYPE
			? [readToolkitUpdate(message.details)] : []);
	const compactionId = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "compaction")?.id ?? null;
	const latest = visible.at(-1);
	const previous = latest?.compactionId === compactionId && visible.some((update) => update.id === latest.rootId)
		? latest : undefined;
	const discoverable = catalog.filter((tool) => isCodeModeToolDiscoverable(tool)
		&& !("discovery" in tool && tool.discovery === "server"));
	const current = new Map(discoverable.map((tool) => [codeModeGlobalName(tool.name), tool]));
	const callable = new Set(catalog.map((tool) => codeModeGlobalName(tool.name)));
	const standingPromoted = new Map(promptCatalog.filter((tool) => "command" in tool && !tool.deferLoading)
		.map((tool) => [codeModeGlobalName(tool.name), tool]));
	const tools: ToolkitTool[] = discoverable.map((tool) => ({
		name: codeModeGlobalName(tool.name),
		description: "discoveryUsage" in tool && tool.discoveryUsage
			? `${tool.discoveryUsage}\n${tool.description ?? ""}`.trim()
			: excerpt(`${"disabledReason" in tool && tool.disabledReason ? "Disabled: " : ""}${tool.description || tool.promptSnippet || tool.usage}`),
		contract: toolContract(tool),
		namespace: tool.namespace?.name ?? "",
	})).sort((left, right) => left.name.localeCompare(right.name));
	const namespaces = Object.fromEntries(discoverable.flatMap((tool) => tool.namespace
		? [[tool.namespace.name, tool.namespace.description?.trim() ?? ""]] : []).sort(([left], [right]) => left!.localeCompare(right!)));
	if (previous && JSON.stringify([previous.tools, previous.namespaces]) === JSON.stringify([tools, namespaces])) return false;
	const oldTools = new Map(previous?.tools.map((tool) => [tool.name, tool]));
	const added = tools.filter((tool) => !oldTools.has(tool.name));
	const changed = tools.filter((tool) => previous
		? oldTools.has(tool.name) && JSON.stringify(tool) !== JSON.stringify(oldTools.get(tool.name))
		: standingPromoted.has(tool.name) && tool.contract !== toolContract(standingPromoted.get(tool.name)!));
	// A new context must override standing contracts even when the earlier removal update was lost.
	const removed = previous
		? previous.tools.filter((tool) => !callable.has(tool.name)).map((tool) => tool.name)
		: [...standingPromoted.keys()].filter((name) => !callable.has(name));
	if (!previous && tools.length === 0 && removed.length === 0) return false;
	const updateLines = (entries: ToolkitTool[]) => entries.flatMap((entry) => {
		const tool = current.get(entry.name)!;
		return !tool.deferLoading ? [`- ${entry.name}:\n${formatCodeModeToolHelp(tool)}`] : toolLines([entry]);
	});
	const instructions = Object.entries(namespaces).filter(([name, description]) => !previous || previous.namespaces[name] !== description)
		.map(([name, description]) => `${name}${description ? `\n${description}` : ""}`);
	const content = [
		previous ? "Toolkit update — current help in ALL_TOOLS; supersedes earlier contracts"
			: standingPromoted.size || discoverable.some((tool) => !tool.deferLoading)
				? "Tool help in ALL_TOOLS; updates supersede standing usage"
				: "Deferred tools — full help in ALL_TOOLS",
		...instructions,
		...(!previous ? toolLines(tools.filter((tool) => current.get(tool.name)!.deferLoading))
			: added.length ? ["Added:", ...updateLines(added)] : []),
		...(changed.length ? ["Changed:", ...updateLines(changed)] : []),
		...(removed.length ? [`Removed: ${removed.join(", ")}. No longer callable; ignore earlier usage`] : []),
	].join("\n");
	const id = randomUUID();
	pi.appendEntry(CODEX_TOOLKIT_UPDATE_TYPE, {
		protocol: 1, id, rootId: previous?.rootId ?? id, compactionId, content, tools, namespaces,
	} satisfies ToolkitUpdate);
	return true;
}

function toolContract(tool: CodeModeToolDefinition): string {
	const help = formatCodeModeToolHelp(tool);
	// Executor changes also invalidate custom-tool contracts without exposing command paths in context.
	return createHash("sha256").update("command" in tool
		? JSON.stringify([help, tool.command, tool.args, tool.input, tool.yieldTimeMs, tool.disabledReason])
		: tool.discoveryUsage ? JSON.stringify([help, tool.discoveryUsage]) : help).digest("hex");
}

function excerpt(description: string): string {
	const line = description.replace(/\s+/g, " ").trim();
	return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

function toolLines(tools: ToolkitTool[]): string[] {
	return tools.map((tool) => `- ${tool.name}: ${tool.description}`);
}
