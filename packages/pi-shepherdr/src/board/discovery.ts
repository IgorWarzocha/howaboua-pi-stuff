import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BoardRuntime } from "@howaboua/pi-agent-comms/runtime";

const CLAIM = "@howaboua/pi-agent-board.owner/v1";
const AVAILABLE = "@howaboua/pi-agent-board.available/v1";

/** The existing owner protocol works across package locations and either load order. */
export function discoverBoard(
	pi: ExtensionAPI,
	attach: (runtime: BoardRuntime) => void,
	failed: (error: Error) => void,
) {
	let attached = false;
	let disposed = false;
	const request = () =>
		pi.events.emit(CLAIM, {
			accept(claim: unknown) {
				if (!claim || typeof claim !== "object" || !("runtime" in claim)) {
					failed(
						new Error(
							"Shared boards could not connect. Update their extension and reload Pi. Other agent operations remain available.",
						),
					);
					return;
				}
				void Promise.resolve(claim.runtime)
					.then((runtime: unknown) => {
						if (disposed || attached) return;
						if (
							!runtime ||
							typeof runtime !== "object" ||
							![
								"attach",
								"enabled",
								"refresh",
								"execute",
								"handle",
								"promptCatchup",
								"toOwner",
							].every(
								(key) =>
									key in runtime &&
									typeof Reflect.get(runtime, key) === "function",
							) ||
							!("active" in runtime) ||
							!(runtime.active instanceof Map)
						) {
							throw new Error(
								"Shared boards could not connect. Update their extension and reload Pi. Other agent operations remain available.",
							);
						}
						attach(runtime as BoardRuntime);
						attached = true;
					})
					.catch((error: unknown) => {
						if (!disposed)
							failed(error instanceof Error ? error : new Error(String(error)));
					});
			},
		});
	const stop = pi.events.on(AVAILABLE, request);
	request();
	pi.on("session_shutdown", () => {
		disposed = true;
		stop();
	});
}
