import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSubdirContextAutoload } from "./src/core/subdir.js";

export default function (pi: ExtensionAPI): void {
	registerSubdirContextAutoload(pi);
}
