import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createBufferedChannel } from "../remote/shepherdr-channel.mjs";
import type { FocusRequest, PaneInfo, PeerChannel } from "../types.js";
import type { CoreClient } from "./client.js";
import { attachCoreTerminal } from "./focus-channel-stream.js";
import { focusWire } from "./focus-channel-wire.mjs";
import { object } from "./protocol.js";
import type { CoreMachine } from "./remote-exec.js";

const moduleUrl = (text: string) =>
	`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
async function helperSources() {
	const read = (name: string) =>
		readFile(new URL(name, import.meta.url), "utf8");
	const [helper, wire, channel, peer] = await Promise.all([
		read("./focus-channel-helper.mjs"),
		read("./focus-channel-wire.mjs"),
		read("../remote/shepherdr-channel.mjs"),
		read("../remote/shepherdr-peer.mjs"),
	]);
	return {
		helper,
		modules: {
			wire: moduleUrl(wire),
			channel: moduleUrl(
				channel.replace(
					'"./shepherdr-peer.mjs"',
					JSON.stringify(moduleUrl(peer)),
				),
			),
		},
	};
}

/** Private Core terminal, authenticated native peer admission, no relay agent. */
export async function openCoreFocusChannel(
	client: CoreClient,
	socketPath: string,
	machine: CoreMachine,
	expected: PaneInfo,
	focus: FocusRequest,
	options: { signal?: AbortSignal } = {},
): Promise<PeerChannel> {
	if (
		!/^t[0-9a-z]+$/.test(expected.pane_id) ||
		expected.pane_id !== expected.terminal_id ||
		expected.agent_session?.kind !== "path"
	)
		throw new Error(
			"Resolve an exact remote Pi terminal and saved session before focus",
		);
	options.signal?.throwIfAborted();
	const { helper, modules } = await helperSources();
	const nonce = randomBytes(8).toString("hex");
	// Only the wire bootstrap belongs in argv; peer modules and focus data travel
	// over its bounded, credited start frame, below Windows' CreateProcessW limit.
	const argv = [
		"node",
		"--input-type=module",
		"-e",
		helper,
		Buffer.from(JSON.stringify({ nonce, wire: modules.wire })).toString(
			"base64",
		),
	];
	// Worst-case Windows quoting, with room for the resolved Node executable path.
	if (argv.reduce((size, arg) => size + arg.length * 2 + 3, 0) > 30_000)
		throw new Error(
			"Remote focus launcher is too large; update Shepherdr before retrying",
		);
	let terminal: string | undefined;
	let stream: ReturnType<typeof attachCoreTerminal> | undefined;
	let wire: ReturnType<typeof focusWire> | undefined;
	let ended = false;
	let started = false;
	let admitted = false;
	let resolveAdmission: () => void = () => {};
	let rejectAdmission: (error: Error) => void = () => {};
	const admission = new Promise<void>((resolve, reject) => {
		resolveAdmission = resolve;
		rejectAdmission = reject;
	});
	// Startup may fail before we reach await admission.
	void admission.catch(() => {});
	const state = createBufferedChannel(
		(message) => {
			if (!admitted || !wire) throw new Error("Focus channel is not admitted");
			wire.send({ type: "data", message });
		},
		() => stop(new Error("Focus channel closed")),
	);
	const timer = setTimeout(
		() =>
			stop(
				new Error(
					"Remote focus admission timed out; inspect the destination before retrying",
				),
			),
		60_000,
	);
	function stop(error: Error) {
		if (ended) return;
		ended = true;
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abort);
		rejectAdmission(error);
		try {
			wire?.send({ type: "close" });
		} catch {}
		wire?.close();
		stream?.close();
		state.fail(error);
		// The remote lease also removes the rm:true terminal if this request cannot reach it.
		if (terminal)
			void client
				.request("terminal.kill", { terminal }, { timeoutMs: 5000 })
				.catch(() => {});
	}
	function abort() {
		stop(
			new Error("Remote focus channel cancelled", {
				cause: options.signal?.reason,
			}),
		);
	}
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	try {
		if (ended) throw new Error("Remote focus channel cancelled during startup");
		const created = object(
			await client.request(
				"terminal.run",
				{
					on: machine.id,
					argv,
					name: `focus-${nonce}`,
					no_parent: true,
					no_notify: true,
					rm: true,
				},
				{ timeoutMs: 20_000 },
			),
		);
		const address = created["address"];
		if (
			typeof address !== "string" ||
			!address.startsWith(`${machine.name}/`) ||
			!/^t[0-9a-z]+$/.test(address.slice(machine.name.length + 1))
		)
			throw new Error("Core returned an unexpected private focus terminal");
		terminal = `${machine.id}/${address.slice(machine.name.length + 1)}`;
		if (ended) {
			void client
				.request("terminal.kill", { terminal }, { timeoutMs: 5000 })
				.catch(() => {});
			throw new Error("Remote focus channel cancelled during startup");
		}
		wire = focusWire(
			nonce,
			(bytes) => {
				if (!stream) throw new Error("Remote focus stream is unavailable");
				stream.write(bytes);
			},
			(value) => {
				const frame = object(value);
				if (frame["type"] === "admitted" && !admitted) {
					admitted = true;
					clearTimeout(timer);
					resolveAdmission();
				} else if (frame["type"] === "data" && admitted && "message" in frame)
					state.receive(frame["message"]);
				else if (frame["type"] === "error")
					throw new Error(
						typeof frame["message"] === "string"
							? frame["message"]
							: "Remote focus failed",
					);
				else
					throw new Error("Remote focus connection sent an invalid response");
			},
			stop,
			() => {
				if (!started) {
					started = true;
					wire?.send({
						type: "start",
						input: {
							coreId: machine.id,
							session: machine.session,
							expected,
							focus,
							modules: { channel: modules.channel },
						},
					});
				}
			},
		);
		stream = attachCoreTerminal(
			socketPath,
			terminal,
			(bytes) => wire?.push(bytes),
			stop,
		);
		await stream.ready;
		await admission;
		return state.channel;
	} catch (error) {
		const reason = error instanceof Error ? error : new Error(String(error));
		stop(reason);
		throw reason;
	}
}
