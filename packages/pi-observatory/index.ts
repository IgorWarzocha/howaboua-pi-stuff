import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { investigateObservatory } from "./src/investigation.ts";
import { openObservatory } from "./src/launcher.ts";
import { recordObservations } from "./src/recorder.ts";

export default function observatoryExtension(pi: ExtensionAPI): void {
	recordObservations(pi);
	pi.registerCommand("observatory", {
		description: "Open the dashboard, or investigate with agent <scope>",
		getArgumentCompletions(prefix) {
			return "agent".startsWith(prefix)
				? [{ label: "agent", value: "agent" }]
				: [];
		},
		async handler(args, ctx) {
			const input = args.trim();
			const investigation = /^agent\s+([\s\S]+)$/.exec(input);
			if (investigation?.[1]) {
				await investigateObservatory(pi, ctx, investigation[1]);
				return;
			}
			if (input) {
				ctx.ui.notify(
					"Use /observatory to open the dashboard, or /observatory agent <scope> to investigate",
					"info",
				);
				return;
			}
			await openObservatory(pi, ctx);
		},
	});
}
