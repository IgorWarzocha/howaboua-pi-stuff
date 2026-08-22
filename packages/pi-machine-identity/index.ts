import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

type MachineConfig = {
	machine: string;
	description: string;
	profile: string;
};

function loadConfig(): MachineConfig {
	const path = join(getAgentDir(), "machine-identity.json");
	const value = JSON.parse(
		readFileSync(path, "utf8"),
	) as Partial<MachineConfig>;
	if (
		!value.machine?.trim() ||
		!value.description?.trim() ||
		!value.profile?.trim()
	) {
		throw new Error(
			`${path} requires non-empty machine, description, and profile strings`,
		);
	}
	return {
		machine: value.machine.trim(),
		description: value.description.trim(),
		profile: value.profile.trim(),
	};
}

export default function machineIdentity(pi: ExtensionAPI) {
	const config = loadConfig();
	const identity = `Current machine: ${config.machine} - ${config.description}`;
	const profile = `Howaclawa profile: ${config.profile}`;

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${identity}\n${profile}`,
	}));
}
