import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { registerDynamicTools } from "./src/tools.js";

export default async function (pi: ExtensionAPI) {
	registerPackageChangelog(pi);
	const runtime = await registerDynamicTools(pi);
	pi.on("session_shutdown", async () => {
		await runtime.shutdown();
	});
}
