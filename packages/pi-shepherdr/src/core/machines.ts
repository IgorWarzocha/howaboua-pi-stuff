import type { CoreClient } from "./client.js";
import { object } from "./protocol.js";

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
