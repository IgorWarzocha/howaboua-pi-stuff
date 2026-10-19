import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openObservatory } from "./src/launcher.ts";

export default function observatoryExtension(pi: ExtensionAPI): void {
	pi.registerCommand("observatory", {
		description: "Open the session failure dashboard",
		async handler(args, ctx) {
			if (args.trim()) {
				ctx.ui.notify("Use /observatory to open the session dashboard", "info");
				return;
			}
			await openObservatory(pi, ctx);
		},
	});
}
