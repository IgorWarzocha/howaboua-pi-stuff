import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeArchive, readSubscribedUpdates } from "../archive.js";
import {
	agentPath,
	type BoardParams,
	boardHelp,
	parseBoardRequest,
} from "../contract.js";
import { binding, members } from "../identity.js";
import type { BoardAdapter } from "../integration.js";
import type { BoardEnvelope } from "../protocol.js";
import type { BoardSummarizer } from "../summarizer.js";
import type { BoardTurns } from "./turns.js";

/** Owner execution begins at membership validation; archive commit precedes delivery. */
export class BoardOwner {
	private readonly turns: BoardTurns;
	private readonly summarizer: BoardSummarizer;
	private readonly adapterOrUndefined: () => BoardAdapter | undefined;
	private readonly adapter: () => BoardAdapter;
	private readonly notify: (
		ctx: ExtensionContext,
		request: BoardEnvelope,
		signal?: AbortSignal,
	) => Promise<unknown>;
	constructor(
		turns: BoardTurns,
		summarizer: BoardSummarizer,
		adapterOrUndefined: () => BoardAdapter | undefined,
		adapter: () => BoardAdapter,
		notify: (
			ctx: ExtensionContext,
			request: BoardEnvelope,
			signal?: AbortSignal,
		) => Promise<unknown>,
	) {
		this.turns = turns;
		this.summarizer = summarizer;
		this.adapterOrUndefined = adapterOrUndefined;
		this.adapter = adapter;
		this.notify = notify;
	}
	async execute(
		ctx: ExtensionContext,
		request: BoardEnvelope,
	): Promise<unknown> {
		const own = binding(ctx);
		if (!("caller" in request)) throw new Error("Invalid board owner request");
		const directory = members(ctx);
		const caller = directory.find(
			(member) =>
				member.sessionId === request.caller.sessionId &&
				member.agentName === request.caller.agentName,
		);
		if (
			!caller ||
			request.caller.boardId !== own.boardId ||
			request.caller.databasePath !== own.databasePath
		)
			throw new Error("Caller not bound to this board");
		if (
			request.operation === "board-unregister" ||
			request.operation === "board-register"
		)
			return this.adapter().commitDirectory(own, directory, caller, request);
		if (request.operation === "board-active") {
			if (own.enabled) this.turns.register(caller, request);
			return true;
		}
		if (request.operation === "board-catchup")
			return own.enabled ? readSubscribedUpdates(caller, request.seen) : [];
		if (request.operation !== "board-call")
			throw new Error("Invalid board owner operation");
		const params = parseBoardRequest(request.params);
		if (params.action === "help")
			return {
				...boardHelp,
				rules: this.adapterOrUndefined()
					? boardHelp.rules
					: {
							...boardHelp.rules,
							agents:
								"Absolute /root/... or child path relative to you; notices require registered members",
						},
				enabled: own.enabled,
			};
		if (!own.enabled)
			throw new Error("Board is off; the user can enable it with /board on");
		const prepared: BoardParams =
			params.author === undefined
				? params
				: { ...params, author: agentPath(params.author, caller.agentName) };
		const active = new Map(this.turns.active);
		const result = await executeArchive(
			{ ...caller, enabled: own.enabled },
			directory.map((member) => member.agentName),
			prepared,
			request.requestId,
		);
		if ("notice" in result && result.notice) {
			// Replayed mutations have no notice: never start or cancel twice for a retry.
			if (params.action === "set_status") {
				if (params.status === "open")
					this.summarizer.cancel(own.boardId, result.notice.thread_id);
				else
					this.summarizer.start(
						ctx,
						own,
						result.notice.thread_id,
						result.notice.message_id,
					);
			}
			for (let start = 0; start < result.recipients.length; start += 16) {
				await Promise.all(
					result.recipients.slice(start, start + 16).map(async (target) => {
						const turn = active.get(target);
						if (!turn) return;
						try {
							await this.notify(
								ctx,
								{
									operation: "board-notify",
									boardId: own.boardId,
									target,
									...turn,
									notice: result.notice,
								},
								AbortSignal.timeout(750),
							);
						} catch {
							/* Committed posts succeed even when a running turn stops accepting. */
						}
					}),
				);
			}
		}
		return result.value;
	}
}
