import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextSharingService } from "@howaboua/pi-agent-comms/context-sharing";
import { binding } from "@howaboua/pi-agent-comms/integration";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import {
	attachmentOwner,
	attachmentRoutes,
	canonicalContextIdentity,
	detachment,
	Identity,
} from "../attachment-protocol.js";
import type { AgentBoard } from "../board/host.js";
import { sessionPath } from "../core/agents.js";
import type { ConnectedMachine } from "../fleet/index.js";
import { sessionContextPath } from "../remote/shepherdr-context.mjs";
import { MEMBER_ENTRY } from "../spawn-context.js";
import type { PaneInfo } from "../types.js";

const Sharing = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	notes: Type.Union([Identity, Type.Null()]),
	boardId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});
type Sharing = Static<typeof Sharing>;
type Access = "shared" | "not shared" | "retained checkpoints only" | "unknown";

/** Read-only facts, never attachment inspection or adoption. */
export function describePeerSharing(
	ctx: ExtensionContext,
	service: ContextSharingService | undefined,
	board: AgentBoard,
): Sharing {
	const notes = service?.describe(ctx);
	if (notes && !Check(Identity, notes))
		throw new Error("Sharing status unavailable");
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		notes: notes ?? null,
		boardId: board.enabled(ctx) ? binding(ctx).boardId : null,
	};
}

function notesAccess(
	ctx: ExtensionContext,
	own: Sharing,
	peer: Sharing,
): Access {
	const from = own.notes;
	const to = peer.notes;
	if (!from || !to) return "not shared";
	if (
		from.sessionId === to.sessionId &&
		from.accountScope === to.accountScope &&
		from.backendUrl === to.backendUrl
	)
		return "shared";
	const routes = attachmentRoutes(ctx);
	for (const route of routes) {
		const link = route.plan.context;
		if (
			route.phase === "ready" &&
			link &&
			isDeepStrictEqual(from, canonicalContextIdentity(link.controller)) &&
			isDeepStrictEqual(to, canonicalContextIdentity(link.target))
		)
			return route.detached?.context ? "retained checkpoints only" : "shared";
	}
	const owner = attachmentOwner(ctx);
	if (
		owner?.context &&
		isDeepStrictEqual(from, canonicalContextIdentity(owner.context.target)) &&
		isDeepStrictEqual(to, canonicalContextIdentity(owner.context.controller))
	)
		return detachment(ctx, owner)?.context
			? "retained checkpoints only"
			: "shared";
	// A standalone family with no edges cannot reach another family. For more
	// complex graphs, absence of a direct edge does not establish lack of access.
	if (
		from.threadId === from.sessionId &&
		!from.routing &&
		!owner?.context &&
		!routes.some((route) => route.plan.context) &&
		!ctx.sessionManager
			.getEntries()
			.some(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === MEMBER_ENTRY &&
					(entry.data as { threadId?: unknown } | undefined)?.threadId ===
						from.threadId,
			)
	)
		return "not shared";
	return "unknown";
}

/** Describe the originator's access to the recipient, not the reverse. */
export async function peerReplyContext(
	ctx: ExtensionContext,
	describe: () => Sharing,
	runtime: ConnectedMachine,
	panel: PaneInfo,
	signal?: AbortSignal,
): Promise<string> {
	let notes: Access = "unknown";
	let board: Access = "unknown";
	try {
		const file = sessionPath(panel);
		if (!file) throw new Error("Target has no saved session");
		const deadline = AbortSignal.timeout(2_000);
		const result = await runtime.client.requestContext(
			sessionContextPath(file),
			{ operation: "peer-sharing" },
			signal ? AbortSignal.any([signal, deadline]) : deadline,
		);
		if (
			!Check(Sharing, result) ||
			(result.notes && result.notes.threadId !== result.sessionId)
		)
			throw new Error("Sharing status unavailable");
		const own = describe();
		notes = notesAccess(ctx, own, result);
		board =
			own.boardId && own.boardId === result.boardId ? "shared" : "not shared";
	} catch {
		// Older/unavailable peers still receive the message, with uncertainty
		// visible rather than turning a failed lookup into an access claim.
		signal?.throwIfAborted();
	}
	return `Sender access at send time — your current Notes: ${notes}; your current Board: ${board}.`;
}
