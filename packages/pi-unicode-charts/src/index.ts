import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformChartMarkdown } from "./chart.js";

const CHART_PROMPT = [
	"Fenced `chart`→display-only Unicode; terminal-small. Use only if clearer than prose/table.",
	"Syntax: `type: bar|line|scatter|sparkline|heatmap`; optional `title:`; `data:` rows e.g. `Label 42`.",
].join("\n");

export default function unicodeCharts(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType === "assistant-thinking") return markdown;
		return transformChartMarkdown(markdown, context.availableWidth);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.systemPrompt.includes(CHART_PROMPT)) return;
		const options = event.systemPromptOptions;
		if (options.forceSystemPrompt === undefined) {
			options.sections["unicode_charts"] = CHART_PROMPT;
			return;
		}
		// An earlier full-prompt override bypasses structured sections.
		options.forceSystemPrompt = `${options.forceSystemPrompt}\n\n${CHART_PROMPT}`;
	});
}

export {
	type ChartSpec,
	type ChartType,
	renderChart,
	transformChartMarkdown,
} from "./chart.js";
