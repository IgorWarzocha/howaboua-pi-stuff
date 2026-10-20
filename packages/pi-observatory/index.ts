import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openObservatory } from "./src/launcher.ts";
import { recordCommandSubmissions } from "./src/recorder.ts";

export default function observatoryExtension(pi: ExtensionAPI): void {
	recordCommandSubmissions(pi);
	pi.registerCommand("observatory", {
		description: "Open the session usage dashboard",
		async handler(args, ctx) {
			if (args.trim()) {
				ctx.ui.notify("Use /observatory to open the session dashboard", "info");
				return;
			}
			await openObservatory(pi, ctx);
		},
	});
}
