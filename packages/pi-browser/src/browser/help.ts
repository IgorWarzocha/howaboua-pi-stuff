export function browserHelp(
	hosts: readonly string[] = [],
): Record<string, unknown> {
	const routed = hosts.length > 0;
	return {
		call: 'Normal Pi: action="help", then a request object. Code/Notebook: tools.browser("help"), then JSON.stringify(request)',
		...(routed ? { host: `optional ${hosts.join(" | ")}` } : {}),
		requests: {
			single: `{ action, ${routed ? "host?, " : ""}...fields }`,
			batch: `{ ${routed ? "host?, " : ""}response_length?, tabs?: [{...}], open?: [{...}], ... }`,
		},
		batching:
			"operations are non-empty arrays; independent items may share one call; dependent steps use separate calls",
		actions: {
			tabs: "query?, offset? -> ref_id/title/url",
			open: "ref_id, lineno?, response_length? to inspect | url to open a tab",
			find: "ref_id, pattern, lineno?, response_length?",
			click: "ref_id, id | selector | x+y",
			type: "ref_id, text, id?; id focuses first",
			screenshot: "ref_id, id? | selector? -> local file",
			navigate: "ref_id, url",
			html: "ref_id, id? | selector?",
			evaluate: "ref_id, expression",
			network: "ref_id",
			load_all: "ref_id, selector, interval_ms?",
			raw: "ref_id, method, params?",
			start: "no fields",
			stop: "ref_id?",
			read_result: `handle, offset${routed ? "; same host" : ""}`,
			discard_result: `handle${routed ? "; same host" : ""}`,
		},
		notes: [
			"Prefer tabs -> open -> click/type; ref_id/id/lineno follow web__run vocabulary",
			"Continue with next_lineno or next_offset; top-level response_length is short|medium|long",
			"Ask before unfamiliar low-trust navigation or consequential external actions unless already authorized",
			"Never close the shared browser after a task",
		],
	};
}
