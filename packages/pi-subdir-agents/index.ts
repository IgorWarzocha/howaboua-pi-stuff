import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";

import { registerSubdirContextAutoload } from "./src/core/subdir.js";

export default function (pi: ExtensionAPI): void {
	registerPackageChangelog(pi);
	registerSubdirContextAutoload(pi);
}
