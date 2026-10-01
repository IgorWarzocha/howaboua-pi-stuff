import { existsSync } from "node:fs";
import type { BoardParams } from "./contract.js";
import { agentPath, MUTATIONS } from "./contract.js";
import type { BoardBinding } from "./identity.js";
import { page } from "./paging.js";
import { boundedBoardRead, checkMutationBudget } from "./response.js";

export async function executeArchive(
	caller: BoardBinding,
	memberNames: readonly string[],
	params: BoardParams,
	requestId: string,
) {
	const write = MUTATIONS.has(params.action);
	if (write) checkMutationBudget(caller.agentName, params);
	let storage: typeof import("./store.js");
	try {
		storage = await import("./store.js");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ERR_UNKNOWN_BUILTIN_MODULE"
		)
			throw new Error(
				"Message boards require Node.js 22.13 or newer with SQLite support",
				{ cause: error },
			);
		throw error;
	}
	storage.validateMutation(params);
	if (write) {
		for (const value of [
			...(params.agents_to_notify ?? []),
			...(params.target_agent === undefined ? [] : [params.target_agent]),
		]) {
			const target = agentPath(value, caller.agentName);
			if (!memberNames.includes(target))
				throw new Error(`Agent not bound to this tree: ${target}`);
		}
	}
	const exists = existsSync(caller.databasePath);
	if (
		!exists &&
		params.action === "search_posts" &&
		params.after_message_id !== undefined
	)
		throw new Error("Post not found in this board");
	if (
		!exists &&
		(!write ||
			(params.action !== "create_channel" &&
				params.new_channel_name === undefined))
	) {
		if (["get_channels", "search_posts", "list_boards"].includes(params.action))
			return { value: page([], params), recipients: [] };
		throw new Error("This board has no channels or posts yet");
	}
	const store = new storage.BoardStore(caller.databasePath, write);
	try {
		const scope = {
			boardId: caller.boardId,
			rootSessionId: caller.rootSessionId,
			ownerFolder: caller.ownerFolder,
			callerSessionId: caller.sessionId,
			agentName: caller.agentName,
			members: memberNames,
		};
		return write
			? store.execute(scope, params, requestId)
			: boundedBoardRead(params, (request) =>
					store.execute(scope, request, requestId),
				);
	} finally {
		store.close();
	}
}
