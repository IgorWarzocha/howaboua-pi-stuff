import { writeSync } from "node:fs";

export default function settledSignal(pi) {
	pi.on("agent_settled", () => {
		try {
			writeSync(3, "settled\n");
		} catch {
			// The wrapper may already have been cancelled.
		}
	});
}
