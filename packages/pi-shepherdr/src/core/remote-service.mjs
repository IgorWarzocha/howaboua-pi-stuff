import { stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { resolve } from "node:path";

const NOTES_UNAVAILABLE =
	"Saved Notes reads are unavailable. Install Notes Compaction or Agent Comms alongside Shepherdr on the controller, then reload Pi. Other agent operations remain available.";

/** Operations that need the selected Core's filesystem or authenticated Pi peers. */
export async function serve(input, send, fail) {
	const [
		{ localCore },
		peer,
		session,
		watch,
		context,
		{ helperContext },
		pi,
		{ terminalPeer },
		{ superviseParents },
	] = await Promise.all([
		import(input.modules.core),
		import(input.modules.peer),
		import(input.modules.session),
		import(input.modules.watch),
		import(input.modules.context),
		import(input.modules.contextHost),
		import(input.modules.pi),
		import(input.modules.terminal),
		import(input.modules.lifetime),
	]);
	const core = localCore(process.env.HC_TERMINAL_SOCKET);
	const terminals = terminalPeer((method, params) =>
		core.request(method, params),
	);
	const subscriptions = new Map();
	const relay = helperContext(context, send);
	let savedSession;
	let savedSessionIndex;
	let closed = false;
	let lifetime;
	const close = async () => {
		if (closed) return;
		closed = true;
		await lifetime?.close();
		for (const subscription of subscriptions.values()) subscription();
		subscriptions.clear();
		core.close();
		await relay.close();
	};
	try {
		const hello = await core.request("hello");
		if (
			hello.core.id !== input.coreId ||
			(process.env.HC_SESSION ?? "default") !== input.session
		)
			throw new Error(
				"Remote Core identity changed; refresh machines before retrying",
			);
		lifetime = await superviseParents(core, (message) => {
			if (!closed) send({ notice: message });
		});
	} catch (error) {
		await close();
		throw error;
	}
	const local = (terminal) =>
		typeof terminal.address === "string" && !terminal.address.includes("/");
	const localEvent = (event) => {
		if (event.method === "snapshot" || event.method === "missed")
			return { ...event, terminals: event.terminals.filter(local) };
		if (
			event.method === "event" &&
			(!event.event.terminal || event.event.terminal.includes("/"))
		)
			return;
		return event;
	};
	async function list() {
		// The local snapshot never fans out to, or silently omits, slow remote Cores.
		let terminals;
		const subscription = core.subscribe(
			{},
			(event) => {
				if (event.method === "snapshot")
					terminals = event.terminals.filter(local);
			},
			() => {},
		);
		try {
			await subscription.ready;
			return { terminals };
		} finally {
			subscription.close();
		}
	}
	async function handle(message) {
		switch (message.op) {
			case "core":
				return message.method === "terminal.list"
					? list()
					: core.request(message.method, message.params);
			case "identity":
				return { host: hostname(), session: input.coreId };
			case "pi-executable":
				return pi.piExecutable(message.cwd);
			case "message":
				return peer.sendPeerMessage(terminals, message.agent, message.message);
			case "focus":
				return peer.sendPeerFocus(terminals, message.agent, message.focus);
			case "commands":
				return peer.sendPeerCommands(terminals, message.agent);
			case "reply":
				return peer.sendPeerExtensionReply(
					terminals,
					message.agent,
					message.reply,
				);
			case "context":
				return relay.request(message.id, (signal) =>
					context.requestContext(message.path, message.request, signal),
				);
			case "saved_session":
				return relay.request(message.id, async (signal) => {
					if (!input.modules.savedSession) throw new Error(NOTES_UNAVAILABLE);
					if (
						typeof message.path !== "string" ||
						typeof message.history !== "boolean"
					)
						throw new Error("Invalid saved session location");
					const reader = await (savedSession ??= import(
						input.modules.savedSession
					));
					const result = await reader.readSavedNotesSession(
						message.path,
						signal,
						message.history,
					);
					if (Buffer.byteLength(JSON.stringify(result)) > 7 * 1024 * 1024)
						throw new Error(
							"Saved session is too large to transfer; open it on its machine to read it",
						);
					return result;
				});
			case "find_saved_sessions":
				return relay.request(message.id, async (signal) => {
					if (!input.modules.savedSessionIndex)
						throw new Error(NOTES_UNAVAILABLE);
					if (typeof message.threadId !== "string")
						throw new Error("Invalid saved session identity");
					const index = await (savedSessionIndex ??= import(
						input.modules.savedSessionIndex
					));
					const result = await index.findSavedNotesSessions(
						message.threadId,
						undefined,
						signal,
					);
					if (Buffer.byteLength(JSON.stringify(result)) > 7 * 1024 * 1024)
						throw new Error(
							"Saved session lookup is too large to transfer; open the session on its machine",
						);
					return result;
				});
			case "context_relay":
				return relay.start(message.threadId, message.routeId);
			case "view":
				return session.readSessionView(message.path);
			case "session_header":
				return session.readSessionHeader(message.path);
			case "directory": {
				const expand = (value) =>
					value === "~"
						? homedir()
						: value.startsWith("~/")
							? resolve(homedir(), value.slice(2))
							: value;
				const path = resolve(
					expand(message.fallback),
					expand(message.value?.trim() || "."),
				);
				if (!(await stat(path)).isDirectory())
					throw new Error("Remote working directory is not a directory");
				return path;
			}
			case "subscribe": {
				const subscription = core.subscribe(
					message.filter ?? {},
					(event) => {
						const value = localEvent(event);
						if (value) send({ subscription: message.id, event: value });
					},
					fail,
				);
				subscriptions.set(message.id, subscription.close);
				await subscription.ready;
				return true;
			}
			case "watch": {
				const stop = watch.watchSessions(
					message.paths,
					(path) => send({ subscription: message.id, path }),
					fail,
				);
				subscriptions.set(message.id, stop);
				return true;
			}
			case "unsubscribe":
				subscriptions.get(message.subscription)?.();
				subscriptions.delete(message.subscription);
				return true;
			default:
				throw new Error("Unknown remote operation");
		}
	}
	return {
		close,
		receive(message) {
			if (closed) return;
			if (
				!message ||
				typeof message.id !== "string" ||
				typeof message.op !== "string"
			)
				throw new Error("Invalid remote request");
			if (relay.consume(message)) return;
			void handle(message)
				.then(
					(result) => {
						if (!closed) send({ id: message.id, ok: true, result });
					},
					(error) => {
						if (!closed)
							send({
								id: message.id,
								ok: false,
								error: {
									message: error.message,
									code: error.code,
									kind: error.kind,
									hint: error.hint,
								},
							});
					},
				)
				.catch(fail);
		},
	};
}
