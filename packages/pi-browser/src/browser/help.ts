export function browserHelp(
	hosts: readonly string[] = [],
	gpt = false,
): Record<string, unknown> {
	const routed = hosts.length > 0;
	return {
		input: gpt
			? "Request={action,...fields}; Pi {command:JSON.stringify(request)}; Code/Notebook JSON.stringify(request), JSON.parse(result)"
			: "Request={action,...fields}; Pi: {command:JSON.stringify(request)}; Code/Notebook: JSON.stringify(request), JSON.parse(result)",
		...(routed
			? {
					host: `${hosts.join("|")}${gpt ? " optional; user-named host→retain every call+its refs/handles" : " optional; keep a user-named host on every call and its refs/handles"}`,
				}
			: {}),
		refs: "tabs -> open; keep ref_id/id/cursors with their result",
		safety: gpt
			? "Unfamiliar low-trust navigation/consequential action→ask first unless authorized; never close shared browser"
			: "Ask before unfamiliar low-trust navigation or consequential action unless authorized; never close shared browser",
		batch: gpt
			? "{action_name:[{...fields}],...}; arrays nonempty; items omit action; host/response_length at root; independent only"
			: "{action_name:[{...fields}],...}; nonempty arrays; items omit action; host/response_length at request root; independent only",
		actions: {
			help: "",
			tabs: "query? offset? owned_only? -> ref_id title url owned",
			open: "ref_id lineno? | url; new tabs open in background",
			show: "ref_id; bring tab to foreground",
			close: "ref_id",
			find: "ref_id pattern lineno?",
			click: "ref_id id|selector|x+y",
			type: "ref_id text id?; id focuses",
			fill: "ref_id id|selector value; replace/clear text, select option value/label, boolean checks/unchecks",
			press: "ref_id key; focused element, e.g. Enter or Control+a",
			wait: "ref_id selector|text|url_includes timeout_ms?; DOM presence or substring, default 10000ms",
			screenshot: "ref_id id?|selector?; brings tab to foreground -> file",
			navigate: "ref_id url",
			html: "ref_id id?|selector?",
			evaluate: "ref_id expression",
			network: "ref_id",
			load_all: "ref_id selector interval_ms?",
			raw: "ref_id method params?",
			start: "",
			stop: "ref_id?; detach without closing tabs",
			read_result: "handle offset",
			discard_result: "handle",
		},
		continue:
			"next_lineno/next_offset; open(ref_id)/find: response_length=short|medium|long",
	};
}
