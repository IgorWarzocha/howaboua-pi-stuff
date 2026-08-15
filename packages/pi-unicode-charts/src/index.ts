import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformChartMarkdown } from "./chart.js";

const CHART_PROMPT = [
	"This session renders explicit fenced `chart` blocks as terminal-native Unicode charts.",
	"Use them only when a compact visual communicates data better than prose or a table.",
	"Format a fenced `chart` block with `type: bar|line|scatter|sparkline|heatmap`, optional `title:`, `data:`, and rows such as `Label 42`.",
	"Charts are display-only and should stay small enough to read in a terminal.",
].join("\n");

export default function unicodeCharts(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType === "assistant-thinking") return markdown;
		return transformChartMarkdown(markdown, context.availableWidth);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.systemPrompt.includes(CHART_PROMPT)) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${CHART_PROMPT}` };
	});
}

export {
	type ChartSpec,
	type ChartType,
	renderChart,
	transformChartMarkdown,
} from "./chart.js";
