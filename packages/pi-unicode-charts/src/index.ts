import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformChartMarkdown } from "./chart.js";

const CHART_PROMPT = [
	"This session renders explicit fenced `chart` blocks as terminal-native Unicode charts",
	"Use them only when a compact visual communicates data better than prose or a table",
	"Format a fenced `chart` block with `type: bar|line|scatter|sparkline|heatmap`, optional `title:`, `data:`, and rows such as `Label 42`.",
	"Charts are display-only and should stay small enough to read in a terminal",
].join("\n");
const GPT_CHART_PROMPT = [
	"Fenced `chart` blocks→terminal-native Unicode charts; display-only.",
	"ONLY if clearer than prose/table; terminal-small.",
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
