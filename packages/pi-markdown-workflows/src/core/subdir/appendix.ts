import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { PersistedContextFile } from "./details.js";

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function appendAgentsContext(
	content: (TextContent | ImageContent)[],
	files: PersistedContextFile[],
): (TextContent | ImageContent)[] {
	if (!files.length) return content;
	const appendix = [
		"<subdirectory_agents_context>",
		"AGENTS.md context relevant to this tool result.",
		...files.map(
			(file) =>
				`<agents_file path="${escapeXml(file.path)}">\n${escapeXml(file.content)}\n</agents_file>`,
		),
		"</subdirectory_agents_context>",
	].join("\n");
	return [...content, { type: "text", text: appendix }];
}
