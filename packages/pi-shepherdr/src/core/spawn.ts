import { randomUUID } from "node:crypto";
import {
	RolledBackAgentLaunchError,
	type StartAgentParams,
	type StartedAgent,
	UnstartedAgentLaunchError,
} from "../launch-contract.js";
import type { CoreConnection } from "./backend.js";
import { piExecutable } from "./pi-executable.mjs";
import { object } from "./protocol.js";
import { RemoteCoreEndpoint } from "./remote-endpoint.js";
import { remoteExec } from "./remote-exec.js";
import { terminalPane, terminalSnapshot } from "./terminal.js";

export async function startCoreAgent(
	client: CoreConnection,
	params: StartAgentParams,
	cwd: string,
	_label: string,
	args: string[],
): Promise<StartedAgent> {
	if (params.placement === "pane")
		throw new Error(
			"Core cannot launch a program inside an existing terminal without terminal input. Use terminal placement for a background worker or new_tab/new_workspace for a Herdr window location.",
		);
	const labels: Record<string, string> = {};
	if (params.placement === "new_tab") {
		const snapshot = terminalSnapshot(
			await client.core.request("terminal.list"),
		);
		if (
			!params.workspace ||
			!snapshot.workspaces.some(
				(space) => space.workspace_id === params.workspace,
			)
		)
			throw new UnstartedAgentLaunchError(
				"new_tab requires a space ID advertised by a live terminal on this Core; use list to find it, or choose new_workspace/terminal placement",
			);
		labels["herdr.space"] = params.workspace;
		labels["herdr.tab"] = `tb${randomUUID().replaceAll("-", "")}`;
	} else if (params.placement === "new_workspace") {
		labels["herdr.space"] = `sp${randomUUID().replaceAll("-", "")}`;
		labels["herdr.tab"] = `tb${randomUUID().replaceAll("-", "")}`;
	} else if (params.placement !== "terminal") {
		throw new UnstartedAgentLaunchError(
			"Choose terminal, new_tab or new_workspace placement for Core",
		);
	}
	const executable =
		client.core instanceof RemoteCoreEndpoint
			? await remoteExec(client.core.host, client.core.machine, {
					op: "pi-executable",
					cwd,
				})
			: await piExecutable(cwd);
	if (typeof executable !== "string" || !executable)
		throw new Error("Could not resolve Pi on the target machine");
	const result = object(
		await client.core.request("terminal.run", {
			argv: [executable, ...args],
			name: params.name,
			cwd,
			parent: process.env["HC_TERMINAL_ID"],
			outlive_parent: true,
			no_notify: true,
			// Labels request adoption only by a window connected to this Core.
			labels,
			env: process.env,
		}),
	);
	const terminal = result["address"];
	if (typeof terminal !== "string" || !/^t[0-9a-z]+$/.test(terminal))
		throw new Error(
			"Core launch returned no local terminal address; inspect Core terminals before retrying",
		);
	const cleanup = { method: "terminal.close" as const, id: terminal };
	try {
		await client.core.request("terminal.label", {
			terminal,
			labels: { "pi.shepherdr.name": params.name },
		});
		const agent = await waitReady(client, terminal);
		return { agent, id: terminal, cleanup };
	} catch (error) {
		try {
			await client.request(cleanup.method, { id: cleanup.id });
		} catch (cleanupError) {
			throw new Error(
				`${String(error)}; cleanup failed: ${String(cleanupError)}`,
				{ cause: error },
			);
		}
		throw new RolledBackAgentLaunchError(error);
	}
}

async function waitReady(client: CoreConnection, terminal: string) {
	const abort = new AbortController();
	let chain = Promise.resolve();
	let resolve!: (agent: ReturnType<typeof terminalPane>) => void;
	let reject!: (error: unknown) => void;
	const ready = new Promise<ReturnType<typeof terminalPane>>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const inspect = (value: unknown) => {
		const record = object(value);
		if (record["state"] !== "live")
			throw new Error(
				`Core terminal ${terminal} exited before publishing its Pi session; inspect its output`,
			);
		const agent = terminalPane(record);
		if (agent.agent_status === "blocked")
			throw new Error(
				`Core terminal ${terminal} is blocked during startup; inspect its output`,
			);
		if (agent.interactive_ready) resolve(agent);
	};
	const timer = setTimeout(
		() =>
			reject(
				new Error(
					`Timed out waiting for ${terminal} to publish its Pi session; inspect its output`,
				),
			),
		30_000,
	);
	try {
		const subscribed = client.core
			.subscribe(
				{ terminal },
				(message) => {
					if (message.method === "snapshot" || message.method === "missed") {
						// Remote mirrors may not contain an acknowledged launch yet.
						if (message.terminals.length === 0)
							chain = chain
								.then(async () =>
									inspect(
										await client.core.request(
											"terminal.get",
											{ terminal },
											{ signal: abort.signal },
										),
									),
								)
								.catch(reject);
						for (const record of message.terminals) inspect(record);
					} else if (message.method === "event") {
						chain = chain
							.then(async () =>
								inspect(
									await client.core.request(
										"terminal.get",
										{ terminal },
										{ signal: abort.signal },
									),
								),
							)
							.catch(reject);
					}
				},
				{ signal: abort.signal },
			)
			.then((sub) => {
				void sub.closed.then((error) => {
					if (error) reject(error);
				});
				return sub;
			});
		const [, agent] = await Promise.all([subscribed, ready]);
		return agent;
	} finally {
		clearTimeout(timer);
		abort.abort();
	}
}
