import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { registerGrokTool } from "@howaboua/pi-grok-realtime/tools";

export default function (pi: ExtensionAPI) {
	registerGrokTool(pi, {
		name: "current_time",
		description: "Current time in an optional IANA time zone",
		parameters: obj({ timeZone: opt(str()) }, { open: false }),
		execute({ timeZone }) {
			const formatter = new Intl.DateTimeFormat("en-GB", {
				dateStyle: "full",
				timeStyle: "long",
				...(timeZone ? { timeZone } : {}),
			});
			return {
				time: formatter.format(new Date()),
				timeZone: formatter.resolvedOptions().timeZone,
			};
		},
	});
}
