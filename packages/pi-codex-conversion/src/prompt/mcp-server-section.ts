import type { AgentMessage } from "@earendil-works/pi-agent-core";

const INTRO = "MCP servers whose tools are not declared to you.";
const CODEMODE = " Call the tools of `codemode` servers from codemode scripts.";
const SEARCH = " Load the tools of `tool_search` servers with `tool_search`.";
const KNOWN_INTROS = new Set([INTRO, INTRO + CODEMODE, INTRO + SEARCH, INTRO + CODEMODE + SEARCH]);
const UNSUPPORTED = "Unsupported Pi MCP server summary format; update Codex Conversion or use Structured mode";
const OPEN = "<mcp_servers>\n";
const CLOSE = "\n</mcp_servers>";

/** Only native renderer positions are adapted; namespace names and summary suffixes are opaque. */
function adaptSection(section: string): string {
	if (!section.startsWith(OPEN) || !section.endsWith(CLOSE)) throw new Error(UNSUPPORTED);
	const [intro, ...lines] = section.slice(OPEN.length, -CLOSE.length).split("\n");
	if (!KNOWN_INTROS.has(intro!) || lines.length === 0) throw new Error(UNSUPPORTED);
	const adapted = lines.map((line, index) => {
		const header = /^(- mcp__[A-Za-z0-9_]+) \((?:codemode|tool_search)\)((?:: [\s\S]*)?)$/.exec(line);
		if (header) return header[1]! + header[2]!;
		if (intro === INTRO && /^- mcp__[A-Za-z0-9_]+(?:: [\s\S]*)?$/.test(line)) return line;
		const omitted = /^(- … [1-9]\d* more servers?)(?:; find their tools with searchTools\(\))?$/.exec(line);
		if (omitted && index === lines.length - 1) return omitted[1]!;
		throw new Error(UNSUPPORTED);
	});
	return OPEN + [INTRO, ...adapted].join("\n") + CLOSE;
}

/** Fresh request projection after all preparation, never persisted-message mutation. */
export function projectCodeModeMcpSections(messages: AgentMessage[], active: boolean): AgentMessage[] {
	if (!active) return messages;
	return messages.map(message => {
		if (message.role !== "system") return message;
		const section = message.sections?.["mcp_servers"];
		if (section === undefined || section === null || section === "") return message;
		if (typeof section !== "string") throw new Error(UNSUPPORTED);
		const adapted = adaptSection(section);
		return adapted === section ? message : {
			...message,
			sections: { ...message.sections, mcp_servers: adapted },
		};
	});
}
