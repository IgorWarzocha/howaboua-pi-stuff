import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformChartMarkdown } from "./chart.js";

const CHART_PROMPT = [
	"Fenced `chart` blocks render as display-only Unicode charts. Keep them small enough for a terminal and use them only if clearer than prose or a table.",
	"Syntax: `type: bar|line|scatter|sparkline|heatmap`, optional `title:`, then `data:` and rows such as `Label 42`.",
].join("\n");
const GPT_CHART_PROMPT = [
	"Fenced `chart`→display-only Unicode; terminal-small. Use only if clearer than prose/table.",
	"Syntax: `type: bar|line|scatter|sparkline|heatmap`; optional `title:`; `data:` rows e.g. `Label 42`.",
].join("\n");

export default async function unicodeCharts(pi: ExtensionAPI): Promise<void> {
	let mode:
		| typeof import("@howaboua/pi-codex-conversion/prompt-mode")
		| undefined;
	try {
		mode = await import("@howaboua/pi-codex-conversion/prompt-mode");
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
	const promptMode = mode?.registerGptPromptMode(pi, () => {});
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType === "assistant-thinking") return markdown;
		return transformChartMarkdown(markdown, context.availableWidth);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.hasUI) return;
		mode?.prepareGptPromptMode(pi, ctx);
		const prompt = promptMode?.active ? GPT_CHART_PROMPT : CHART_PROMPT;
		if (event.systemPrompt.includes(prompt)) return;
		const options = event.systemPromptOptions;
		if (options.forceSystemPrompt === undefined) {
			options.sections["unicode_charts"] = prompt;
			return;
		}
		// An earlier full-prompt override bypasses structured sections.
		const forced = options.forceSystemPrompt;
		const previous = promptMode?.active ? CHART_PROMPT : GPT_CHART_PROMPT;
		options.forceSystemPrompt = forced.includes(previous)
			? forced.replace(previous, prompt)
			: `${forced}\n\n${prompt}`;
	});
}

export {
	type ChartSpec,
	type ChartType,
	renderChart,
	transformChartMarkdown,
} from "./chart.js";
