import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ContextSharingService } from "@howaboua/pi-agent-comms/context-sharing";

export const NOTES_UNAVAILABLE =
	"Shared Notes require active, compatible Notes Compaction or Agent Comms in both sessions. Enable or update it, then reload Pi. Other agent operations remain available.";

/** Notes' public v1 broker, shared with released Notes Compaction. */
export function connectNotesContextSharing(
	pi: ExtensionAPI,
	onAvailable: () => void,
) {
	let service: ContextSharingService | undefined;
	let context: ExtensionContext | undefined;
	let failure: Error | undefined;
	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		if (failure) ctx.ui.notify(failure.message, "error");
	});
	const off = pi.events.on(
		"pi-notes-compaction:context-sharing:available",
		(value) => {
			if (
				!value ||
				typeof value !== "object" ||
				!("protocol" in value) ||
				value.protocol !== 1 ||
				![
					"canCreateChild",
					"describe",
					"verify",
					"createChild",
					"bind",
					"execute",
					"registerRouter",
				].every(
					(key) =>
						key in value && typeof Reflect.get(value, key) === "function",
				)
			) {
				failure = new Error(
					"Shared Notes could not connect. Update their extension and reload Pi. Other agent operations remain available.",
				);
				context?.ui.notify(failure.message, "error");
				throw failure;
			}
			failure = undefined;
			service = value as ContextSharingService;
			onAvailable();
		},
	);
	pi.events.emit("pi-notes-compaction:context-sharing:request", {
		protocol: 1,
	});
	return {
		get service() {
			return service;
		},
		dispose() {
			off();
			service = undefined;
			context = undefined;
		},
	};
}
