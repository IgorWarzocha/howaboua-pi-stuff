import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Core observes only status reports written by the program in its terminal. */
export function registerCoreStatus(pi: ExtensionAPI): void {
	if (
		!process.env["HC_TERMINAL_ID"] ||
		!process.env["HC_TERMINAL_SOCKET"] ||
		!process.stdout.isTTY
	)
		return;
	let active = false;
	let running = false;
	let failed = false;
	let blocked = 0;
	let last = "";
	const publish = (state: string) => {
		if (!active || state === last) return;
		last = state;
		process.stdout.write(`\x1b]7501;state=${state}:app=pi\x1b\\`);
	};
	const current = () =>
		publish(blocked ? "blocked" : running ? "working" : "idle");
	pi.events.on("herdr:blocked", (value: unknown) => {
		if (
			!active ||
			typeof value !== "object" ||
			value === null ||
			!("active" in value) ||
			typeof value.active !== "boolean"
		)
			return;
		blocked = value.active ? blocked + 1 : Math.max(0, blocked - 1);
		current();
	});
	pi.on("session_start", (_event, ctx) => {
		active = ctx.mode === "tui";
		blocked = 0;
		running = !ctx.isIdle();
		failed = false;
		last = "";
		current();
	});
	pi.on("before_agent_start", () => {
		running = true;
		failed = false;
		current();
	});
	pi.on("agent_start", () => {
		running = true;
		current();
	});
	pi.on("agent_end", (event) => {
		const reply = event.messages.findLast(
			(message) => message.role === "assistant",
		);
		failed = reply?.role === "assistant" && reply.stopReason === "error";
	});
	pi.on("agent_settled", (event) => {
		running = false;
		publish(
			blocked ? "blocked" : event.aborted ? "idle" : failed ? "error" : "done",
		);
	});
	pi.on("session_shutdown", () => {
		publish("clear");
		active = false;
	});
}
