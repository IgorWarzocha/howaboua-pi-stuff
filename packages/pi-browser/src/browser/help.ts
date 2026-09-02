export function browserHelp(
	hosts: readonly string[] = [],
): Record<string, unknown> {
	const routed = hosts.length > 0;
	return {
		input: "Code=JSON.stringify(request); normal=request",
		...(routed ? { host: `${hosts.join("|")} optional` } : {}),
		batch:
			"top-level nonempty action arrays; items omit action/host/response_length; independent only",
		actions: {
			tabs: "query? offset? -> ref_id title url",
			open: "ref_id lineno? response_length? | url",
			find: "ref_id pattern lineno? response_length?",
			click: "ref_id id|selector|x+y",
			type: "ref_id text id?; id focuses",
			screenshot: "ref_id id?|selector? -> file",
			navigate: "ref_id url",
			html: "ref_id id?|selector?",
			evaluate: "ref_id expression",
			network: "ref_id",
			load_all: "ref_id selector interval_ms?",
			raw: "ref_id method params?",
			start: "",
			stop: "ref_id?",
			read_result: `handle offset${routed ? "; same host" : ""}`,
			discard_result: `handle${routed ? "; same host" : ""}`,
		},
		continue: "next_lineno/next_offset; response_length=short|medium|long",
	};
}
