import { compile } from "@earendil-works/pi-schema";
import { Text } from "@earendil-works/pi-tui";
import { WEB_SEARCH_PARAMETERS } from "./contract.js";

interface RenderTheme {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

const webSearchArguments = compile(WEB_SEARCH_PARAMETERS);

function summarizeWebActivity(
	args: unknown,
	pending: boolean,
): { title: string; detail?: string } {
	const fallback = { title: "Web request" };
	if (!webSearchArguments.check(args)) return fallback;
	const {
		search_query,
		image_query,
		open,
		click,
		find,
		response_length: _responseLength,
		settings: _settings,
		...otherCommands
	} = args;
	if (Object.keys(otherCommands).some((key) => key !== "max_output_tokens"))
		return fallback;

	const batches = [
		{
			title: pending ? "Searching the web" : "Searched the web",
			details: (search_query ?? []).map(
				({ q }) => q.trim() && `for ${q.trim()}`,
			),
		},
		{
			title: pending ? "Searching images" : "Searched images",
			details: (image_query ?? []).map(
				({ q }) => q.trim() && `for ${q.trim()}`,
			),
		},
		{
			title: pending ? "Opening" : "Opened",
			details: (open ?? []).map(({ ref_id }) => ref_id.trim()),
		},
		{
			title: pending ? "Opening" : "Opened",
			details: (click ?? []).map(
				({ ref_id, id }) => ref_id.trim() && `link ${id} in ${ref_id.trim()}`,
			),
		},
		{
			title: pending ? "Searching for" : "Searched for",
			details: (find ?? []).map(
				({ ref_id, pattern }) =>
					ref_id.trim() &&
					pattern.trim() &&
					`'${pattern.trim()}' in ${ref_id.trim()}`,
			),
		},
	];
	const used = batches.filter(({ details }) => details.length > 0);
	if (used.some(({ details }) => details.includes(""))) return fallback;
	if (used.length > 1)
		return {
			title: pending ? "Browsing the web" : "Browsed the web",
			detail: `${used.reduce((count, { details }) => count + details.length, 0)} actions`,
		};
	const batch = used[0];
	const first = batch?.details[0];
	if (!batch || !first) return fallback;
	const additional = batch.details.length - 1;
	return {
		title: batch.title,
		detail: additional > 0 ? `${first} (+${additional} more)` : first,
	};
}

export function renderWebSearchCall(
	args: unknown,
	theme: RenderTheme,
	{ isPartial, isError }: { isPartial: boolean; isError: boolean },
): Text {
	const { title, detail } = summarizeWebActivity(args, isPartial);
	return new Text(
		theme.fg("toolTitle", theme.bold(isError ? "Web request failed" : title)) +
			(detail ? " " + theme.fg("muted", detail) : ""),
		0,
		0,
	);
}
