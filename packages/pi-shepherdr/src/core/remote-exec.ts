import { readFile } from "node:fs/promises";
import type { CoreClient, CoreRequestOptions } from "./client.js";
import { type CoreObject, object } from "./protocol.js";

export interface CoreMachine {
	id: string;
	name: string;
	host: string;
	session: string;
	state: string;
}

export async function coreMachines(client: CoreClient): Promise<CoreMachine[]> {
	const machines = object(await client.request("machine.list"))["machines"];
	if (!Array.isArray(machines))
		throw new Error("Core returned no machine catalog");
	return machines.map((value) => {
		const machine = object(value);
		for (const field of ["id", "name", "host", "state"])
			if (typeof machine[field] !== "string" || !machine[field])
				throw new Error("Core returned an invalid machine identity");
		return {
			id: machine["id"] as string,
			name: machine["name"] as string,
			host: machine["host"] as string,
			state: machine["state"] as string,
			session:
				typeof machine["session"] === "string" ? machine["session"] : "default",
		};
	});
}

const moduleUrl = (source: string) =>
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let bundle:
	| Promise<{ source: string; modules: Record<string, string> }>
	| undefined;
async function sources() {
	const read = (path: string) =>
		readFile(new URL(path, import.meta.url), "utf8");
	const [source, peer, session, watch, checkpoints, context, relay, pi] =
		await Promise.all([
			readFile(new URL("./remote-helper.mjs", import.meta.url), "utf8"),
			read("../remote/shepherdr-peer.mjs"),
			read("../remote/shepherdr-session.mjs"),
			read("../remote/shepherdr-session-watch.mjs"),
			read("../remote/shepherdr-checkpoints.mjs"),
			read("../remote/shepherdr-context.mjs"),
			read("./context-relay.mjs"),
			read("./pi-executable.mjs"),
		]);
	const peerUrl = moduleUrl(peer);
	return {
		source,
		modules: {
			pi: moduleUrl(pi),
			relay: moduleUrl(relay),
			peer: peerUrl,
			session: moduleUrl(session),
			watch: moduleUrl(watch),
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

/** One bounded remote process; never retries a possibly delivered operation. */
export async function remoteExec(
	client: CoreClient,
	machine: CoreMachine,
	input: CoreObject,
	options: CoreRequestOptions = {},
): Promise<unknown> {
	const { source, modules } = await (bundle ??= sources());
	const result = object(
		await client.request(
			"machine.exec",
			{
				on: machine.id,
				argv: ["node", "--input-type=module", "-e", source],
				timeout: input["op"] === "watch" ? 20 : 90,
				input: Buffer.from(
					JSON.stringify({
						...input,
						coreId: machine.id,
						session: machine.session,
						modules,
					}),
				).toString("base64"),
			},
			{ timeoutMs: 100_000, ...options },
		),
	);
	if (
		result["timed_out"] ||
		result["truncated"] ||
		result["code"] !== 0 ||
		typeof result["stdout"] !== "string"
	)
		throw new Error(
			"Remote operation did not finish; inspect the target before retrying and verify Node.js and hc are available in the selected Core's PATH",
		);
	const receipt = object(
		JSON.parse(Buffer.from(result["stdout"], "base64").toString()),
	);
	if (receipt["ok"] !== true)
		throw Object.assign(
			new Error(
				typeof receipt["error"] === "string"
					? receipt["error"]
					: "Remote operation failed",
			),
			{ code: receipt["code"] },
		);
	return receipt["result"];
}
