import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";

import { registerSubdirContextAutoload } from "./src/core/subdir.js";

export default async function (pi: ExtensionAPI): Promise<void> {
	registerPackageChangelog(pi);
	registerSubdirContextAutoload(pi, await loadDeveloperMessages());
}

async function loadDeveloperMessages(): Promise<
	| Partial<typeof import("@howaboua/pi-codex-conversion/developer-messages")>
	| undefined
> {
	try {
		return await import("@howaboua/pi-codex-conversion/developer-messages");
	} catch (error) {
		if (!isUnavailable(error)) throw error;
		return undefined;
	}
}

function isUnavailable(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	const packageName = "@howaboua/pi-codex-conversion";
	const moduleName = `${packageName}/developer-messages`;
	if (
		error.code === "ERR_MODULE_NOT_FOUND" ||
		error.code === "MODULE_NOT_FOUND"
	) {
		const missing = error.message.match(
			/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
		)?.[1];
		const normalized = missing?.replaceAll("\\", "/").replace(/\.js$/, "");
		return (
			missing === packageName ||
			normalized === moduleName ||
			normalized?.endsWith(`/${moduleName}`) === true
		);
	}
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(moduleName) ||
			(error.message.includes("Package subpath './developer-messages'") &&
				error.message.includes(packageName)))
	);
}
