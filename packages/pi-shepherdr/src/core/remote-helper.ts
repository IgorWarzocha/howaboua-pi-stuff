import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CoreClient } from "./client.js";
import { attachCoreTerminal } from "./focus-channel-stream.js";
import { focusWire } from "./focus-channel-wire.mjs";
import type { CoreMachine } from "./machines.js";
import { type CoreObject, object } from "./protocol.js";

const moduleUrl = (source: string) =>
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let bundle: ReturnType<typeof sources> | undefined;
async function sources() {
	const read = (path: string) =>
		readFile(new URL(path, import.meta.url), "utf8");
	const [
		bootstrap,
		wire,
		helper,
		core,
		contextHost,
		peer,
		session,
		watch,
		context,
		checkpoints,
		pi,
		terminal,
	] = await Promise.all([
		read("./helper-bootstrap.mjs"),
		read("./focus-channel-wire.mjs"),
		read("./remote-service.mjs"),
		read("./helper-core.mjs"),
		read("./helper-context.mjs"),
		read("../remote/shepherdr-peer.mjs"),
		read("../remote/shepherdr-session.mjs"),
		read("../remote/shepherdr-session-watch.mjs"),
		read("../remote/shepherdr-context.mjs"),
		read("../remote/shepherdr-checkpoints.mjs"),
		read("./pi-executable.mjs"),
		read("./terminal-peer.mjs"),
	]);
	const peerUrl = moduleUrl(peer);
	return {
		bootstrap,
		wire: moduleUrl(wire),
		modules: {
			helper: moduleUrl(helper),
			core: moduleUrl(core),
			contextHost: moduleUrl(contextHost),
			peer: peerUrl,
			session: moduleUrl(session),
			watch: moduleUrl(watch),
			pi: moduleUrl(pi),
			terminal: moduleUrl(terminal),
			context: moduleUrl(
				context
					.replace('"./shepherdr-peer.mjs"', JSON.stringify(peerUrl))
					.replace(
						'"./shepherdr-checkpoints.mjs"',
						JSON.stringify(moduleUrl(checkpoints)),
					),
			),
		},
	};
}

export interface RemoteHelper {
	send(message: CoreObject): void;
	close(): Promise<void>;
}

/** One private Core-owned process; credited attachment carries all control traffic. */
export async function openRemoteHelper(
	socketPath: string,
	machine: CoreMachine,
	onMessage: (message: CoreObject) => void,
	onClose: (error: Error) => void,
	signal: AbortSignal,
): Promise<RemoteHelper> {
	signal.throwIfAborted();
	const source = await (bundle ??= sources());
	signal.throwIfAborted();
	const client = new CoreClient(socketPath);
	const nonce = randomBytes(8).toString("hex");
	const argv = [
		"node",
		"--input-type=module",
		"-e",
		source.bootstrap,
		Buffer.from(JSON.stringify({ nonce, wire: source.wire })).toString(
			"base64",
		),
	];
	if (argv.reduce((size, arg) => size + arg.length * 2 + 3, 0) > 30_000)
		throw new Error(
			"Remote launcher exceeds the supported command size; update Shepherdr",
		);
	let terminal: string | undefined;
	let launch: Promise<void> | undefined;
	let stream: ReturnType<typeof attachCoreTerminal> | undefined;
	let wire: ReturnType<typeof focusWire> | undefined;
	let ended = false;
	let started = false;
	let admitted = false;
	let resolveReady: () => void = () => {};
	let rejectReady: (error: Error) => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	void ready.catch(() => {});
	let resolveClosed: () => void = () => {};
	const closed = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	let closing: Promise<void> | undefined;
	let cleaning: Promise<void> | undefined;
	const cleanup = () =>
		(cleaning ??= (async () => {
			// Keep the response socket until accepted startup reveals its address.
			await launch?.catch(() => {});
			wire?.close();
			stream?.close();
			if (terminal)
				await client
					.request("terminal.kill", { terminal }, { timeoutMs: 5000 })
					.catch(() => {});
			client.close();
		})());
	const finish = (error?: Error): Promise<void> => {
		if (closing) return closing;
		ended = true;
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
		rejectReady(error ?? new Error("Remote connection closed"));
		closing = (async () => {
			let timeout: NodeJS.Timeout | undefined;
			try {
				if (wire && admitted) {
					try {
						wire.send({ type: "close" });
					} catch {}
					// The helper closes listeners before acknowledging. Its 10s wire
					// lease also bounds cleanup after loss of the Core route.
					await Promise.race([
						closed,
						new Promise<void>((resolve) => {
							timeout = setTimeout(resolve, 12_000);
						}),
					]);
				}
			} finally {
				clearTimeout(timeout);
				await cleanup();
			}
		})();
		if (error) onClose(error);
		return closing;
	};
	const failed = (error: Error) => {
		void finish(error);
	};
	const abort = () =>
		failed(new Error("Remote connection cancelled", { cause: signal.reason }));
	const timer = setTimeout(
		() =>
			failed(
				new Error(
					"Remote connection did not become ready; check Node.js on the target machine",
				),
			),
		30_000,
	);
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	try {
		if (ended) throw new Error("Remote connection cancelled during startup");
		launch = client
			.request(
				"terminal.run",
				{
					on: machine.id,
					argv,
					name: `shepherdr-${nonce}`,
					no_parent: true,
					no_notify: true,
					rm: true,
					labels: { "shepherdr.role": "connection" },
				},
				{ timeoutMs: 20_000 },
			)
			.then((value) => {
				const address = object(value)["address"];
				const local =
					typeof address === "string" ? address.split("/").at(-1) : undefined;
				if (!local || !/^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/.test(local))
					throw new Error("Core returned an invalid connection terminal");
				terminal = `${machine.id}/${local}`;
			});
		await launch;
		if (!terminal) throw new Error("Core returned no connection terminal");
		if (ended) {
			await cleanup();
			throw new Error("Remote connection cancelled during startup");
		}
		wire = focusWire(
			nonce,
			(bytes) => {
				if (!stream) throw new Error("Remote connection is not attached");
				stream.write(bytes);
			},
			(value) => {
				const message = object(value);
				if (message["type"] === "closed") {
					resolveClosed();
					return;
				}
				if (ended) return;
				if (message["type"] === "ready" && !admitted) {
					admitted = true;
					clearTimeout(timer);
					resolveReady();
				} else if (message["type"] === "error") {
					throw new Error(
						typeof message["message"] === "string"
							? message["message"]
							: "Remote connection failed",
					);
				} else if (admitted) onMessage(message);
				else throw new Error("Remote connection sent data before admission");
			},
			failed,
			() => {
				if (started || ended) return;
				started = true;
				wire?.send({
					type: "start",
					input: {
						coreId: machine.id,
						session: machine.session,
						modules: source.modules,
					},
				});
			},
			{ maxMessageBytes: 8 * 1024 * 1024, maxQueuedBytes: 24 * 1024 * 1024 },
		);
		stream = attachCoreTerminal(
			socketPath,
			terminal,
			(bytes) => wire?.push(bytes),
			(error) => {
				resolveClosed();
				if (!ended) failed(error);
			},
		);
		await stream.ready;
		await ready;
		return {
			send(message) {
				if (ended || !wire) throw new Error("Remote connection is closed");
				wire.send(message);
			},
			close: () => finish(),
		};
	} catch (error) {
		await finish(error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}
