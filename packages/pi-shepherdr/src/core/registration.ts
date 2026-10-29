import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CoreClient } from "./client.js";
import { object } from "./protocol.js";

export const CORE_SESSION_LABEL = "pi.session_file";

export interface CoreIdentity {
	terminalId: string;
	socketPath: string;
}

export function coreIdentity(ctx: ExtensionContext): CoreIdentity | undefined {
	const terminalId = process.env["HC_TERMINAL_ID"];
	const socketPath = process.env["HC_TERMINAL_SOCKET"];
	return ctx.mode === "tui" && terminalId && socketPath
		? { terminalId, socketPath }
		: undefined;
}

/** Publish only after the authenticated receiver is ready; never label its token. */
export async function publishCoreSession(
	identity: CoreIdentity,
	sessionFile: string,
): Promise<() => Promise<void>> {
	const client = new CoreClient(identity.socketPath);
	const terminal = identity.terminalId;
	try {
		await client.request("terminal.label", {
			terminal,
			labels: { [CORE_SESSION_LABEL]: sessionFile },
		});
	} catch (error) {
		client.close();
		throw error;
	}
	return async () => {
		try {
			const current = object(
				await client.request("terminal.get", { terminal }),
			);
			const labels = object(current["labels"]);
			if (labels[CORE_SESSION_LABEL] === sessionFile)
				await client.request("terminal.label", {
					terminal,
					labels: { [CORE_SESSION_LABEL]: "" },
				});
		} finally {
			client.close();
		}
	};
}
