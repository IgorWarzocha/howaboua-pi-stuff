export function browserHelp(): Record<string, unknown> {
	return {
		call: 'Normal Pi: action="help", then a request object. Code/Notebook: tools.browser("help"), then JSON.stringify(request)',
		requests: {
			single: "{ action, ...fields }",
			batch: "{ response_length?, tabs?: [{...}], open?: [{...}], ... }",
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
			read_result: "handle, offset",
			discard_result: "handle",
		},
		notes: [
			"Prefer tabs -> open -> click/type; ref_id/id/lineno follow web__run vocabulary",
			"Continue with next_lineno or next_offset; top-level response_length is short|medium|long",
			"Ask before unfamiliar low-trust navigation or consequential external actions unless already authorized",
			"Never close the shared browser after a task",
		],
	};
}
