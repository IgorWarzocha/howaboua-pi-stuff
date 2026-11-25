import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionReply } from "./types.js";

const EXTENSION_REPLY_EVENT = "@howaboua/pi-shepherdr/extension-reply/v1";

/** Producers claim synchronously and resolve only after semantic delivery/persistence. */
export async function dispatchExtensionReply(
	pi: ExtensionAPI,
	reply: ExtensionReply,
): Promise<string> {
	let claimed: Promise<string> | undefined;
	let accepting = true;
	try {
		pi.events.emit(EXTENSION_REPLY_EVENT, {
			...reply,
			respond(result: Promise<string> | string) {
				if (!accepting || claimed)
					throw new Error("Extension reply already claimed or dispatch ended");
				claimed = Promise.resolve(result);
			},
		});
	} finally {
		accepting = false;
	}
	if (!claimed)
		throw new Error(
			`Reply handler for ${JSON.stringify(reply.extension)} is unavailable; reload that extension in the target session`,
		);
	const result = await claimed;
	if (typeof result !== "string")
		throw new Error(
			"Invalid extension reply receipt. Inspect the target before retrying",
		);
	return result;
}
