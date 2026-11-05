import { existsSync } from "node:fs";
import type { BoardParams } from "./contract.js";
import { agentPath, MUTATIONS } from "./contract.js";
import type { BoardBinding } from "./identity.js";
import { page } from "./paging.js";
import { boundedBoardRead, checkMutationBudget } from "./response.js";

export async function readSubscribedUpdates(
	caller: BoardBinding,
	seen: string[],
	aliases: [string, string][] = [],
) {
	if (!existsSync(caller.databasePath)) return [];
	const { BoardStore } = await import("./store.js");
	const store = new BoardStore(caller.databasePath, false, aliases);
	try {
		const identities = JSON.stringify(store.agentIdentities(caller.agentName));
		return store.all<{ message_id: string; thread_id: string }>(
			`SELECT p.id AS message_id,p.root AS thread_id FROM posts p
			WHERE p.board_id=? AND p.author NOT IN (SELECT value FROM json_each(?)) AND NOT EXISTS
			(SELECT 1 FROM json_each(?) WHERE value=p.id) AND EXISTS
			(SELECT 1 FROM subscriptions s WHERE s.board_id=p.board_id
			AND s.agent IN (SELECT value FROM json_each(?)) AND s.enabled=1
			AND (s.agent=? OR NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.board_id=s.board_id AND n.target=s.target AND n.agent=?))
			AND s.target=CASE WHEN p.id=p.root THEN 'channel:'||p.channel ELSE 'thread:'||p.root END)
			ORDER BY p.seq ASC LIMIT 50`,
			caller.boardId,
			identities,
			JSON.stringify(seen),
			identities,
			caller.agentName,
			caller.agentName,
		);
	} finally {
		store.close();
	}
}

export async function executeArchive(
	caller: BoardBinding,
	memberNames: readonly string[],
	params: BoardParams,
	requestId: string,
	aliases: [string, string][] = [],
) {
	if (
		params.action === "set_status" &&
		caller.sessionId !== caller.rootSessionId
	)
		throw new Error("Only the parent session can change thread status");
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
			const path = agentPath(value, caller.legacyAgentName ?? caller.agentName);
			const target = new Map(aliases).get(path) ?? path;
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
	const store = new storage.BoardStore(caller.databasePath, write, aliases);
	try {
		const scope = {
			boardId: caller.boardId,
			rootSessionId: caller.rootSessionId,
			ownerFolder: caller.ownerFolder,
			callerSessionId: caller.sessionId,
			agentName: caller.agentName,
			...(caller.legacyAgentName
				? { legacyAgentName: caller.legacyAgentName }
				: {}),
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
