import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BoardRuntime } from "./coordinator.js";

export type { BoardRuntime };

const CLAIM = "@howaboua/pi-agent-board.owner/v1";
const AVAILABLE = "@howaboua/pi-agent-board.available/v1";
interface OwnerClaim {
	runtime: Promise<BoardRuntime>;
}

/** Discover an explicitly loaded owner, including one loaded after this adapter. */
export function discoverBoard(
	pi: ExtensionAPI,
	attach: (runtime: BoardRuntime) => void,
) {
	let attached = false;
	const accept = (runtime: BoardRuntime) => {
		if (attached) return;
		attached = true;
		attach(runtime);
	};
	const request = () =>
		pi.events.emit(CLAIM, {
			accept: (claim: OwnerClaim) => {
				void claim.runtime.then(accept);
			},
		});
	const stop = pi.events.on(AVAILABLE, request);
	request();
	pi.on("session_shutdown", stop);
}

/** Only an explicitly loaded Board extension claims the owner; its engine stays lazy. */
export async function acquireBoard(pi: ExtensionAPI): Promise<BoardRuntime> {
	let claim: OwnerClaim | undefined;
	pi.events.emit(CLAIM, {
		accept(value: OwnerClaim) {
			claim = value;
		},
	});
	if (!claim) {
		const created: OwnerClaim = {
			runtime: import("./coordinator.js").then(
				({ BoardRuntime }) => new BoardRuntime(pi),
			),
		};
		claim = created;
		const stop = pi.events.on(CLAIM, (value) => {
			if (
				value &&
				typeof value === "object" &&
				"accept" in value &&
				typeof value.accept === "function"
			)
				value.accept(created);
		});
		pi.on("session_shutdown", stop);
	}
	const runtime = await claim.runtime;
	pi.events.emit(AVAILABLE, undefined);
	return runtime;
}
