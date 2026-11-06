import { closeTerminal } from "./core/agents.js";
import type { CoreConnection } from "./core/backend.js";
import {
	type CreatedLocationCleanup,
	RolledBackAgentLaunchError,
} from "./launch-contract.js";

export async function rollbackCreatedLocation(
	client: CoreConnection,
	cleanup: CreatedLocationCleanup | undefined,
	cause: unknown,
): Promise<never> {
	if (!cleanup) throw cause;
	try {
		await closeTerminal(client, cleanup.id);
	} catch (cleanupError) {
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}; rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
			{ cause },
		);
	}
	throw new RolledBackAgentLaunchError(cause);
}
