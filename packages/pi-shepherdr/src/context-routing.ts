import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextAgentIdentity } from "@howaboua/pi-notes-compaction/context-sharing";
import {
	attachmentOwner,
	attachmentRoutes,
	canonicalContextIdentity,
	detachment,
} from "./attachment-protocol.js";
import type { AgentFleet } from "./fleet/index.js";
import {
	isContextUnavailable,
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import { MEMBER_ENTRY, type Member } from "./spawn-context.js";

interface ContextRoute {
	sessionId: string;
	counterpart?: { agentName: string; descendants: boolean };
	via: { machine: string; sessionFile: string } | { upstream: string };
}

export function sendContextRoute(
	fleet: AgentFleet,
	route: ContextRoute,
	value: unknown,
	signal?: AbortSignal,
) {
	return "upstream" in route.via
		? requestContext(route.via.upstream, value, signal)
		: fleet
				.connected(route.via.machine)
				.client.requestContext(
					sessionContextPath(route.via.sessionFile),
					value,
					signal,
				);
}

function contextChildren(
	ctx: ExtensionContext,
	identity: ContextAgentIdentity,
): Member[] {
	const children = new Map<string, Member>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== MEMBER_ENTRY) continue;
		const value = entry.data as Partial<Member> | undefined;
		if (
			value?.threadId !== identity.threadId ||
			value.sessionId !== identity.sessionId
		)
			continue;
		if (
			typeof value.agentName !== "string" ||
			typeof value.machine !== "string" ||
			typeof value.sessionFile !== "string" ||
			!value.sessionFile
		)
			throw new Error("Invalid saved shared context route");
		children.set(JSON.stringify([value.machine, value.sessionFile]), {
			agentName: value.agentName,
			machine: value.machine,
			sessionFile: value.sessionFile,
			threadId: value.threadId,
			sessionId: value.sessionId,
		});
	}
	return [...children.values()];
}

function contextRoutes(
	ctx: ExtensionContext,
	identity: ContextAgentIdentity,
	visited: string[],
): ContextRoute[] {
	const routes: ContextRoute[] = contextChildren(ctx, identity).map(
		(child) => ({ sessionId: identity.sessionId, via: child }),
	);
	for (const route of attachmentRoutes(ctx)) {
		const link = route.plan.context;
		if (
			route.phase !== "ready" ||
			!link ||
			visited.includes(link.target.threadId)
		)
			continue;
		if (!isDeepStrictEqual(identity, canonicalContextIdentity(link.controller)))
			throw new Error(
				"Shared notes are unavailable. Use messages to exchange the context you need.",
			);
		routes.push({
			sessionId: link.target.sessionId,
			counterpart: {
				agentName: `/${link.target.threadId}`,
				descendants:
					link.target.storage === "session" && !route.detached?.context,
			},
			via: { machine: route.machine, sessionFile: route.sessionFile },
		});
	}
	const owner = attachmentOwner(ctx);
	const link = owner?.context;
	if (owner && link && !visited.includes(link.controller.threadId)) {
		if (!isDeepStrictEqual(identity, canonicalContextIdentity(link.target)))
			throw new Error(
				"Shared notes are unavailable. Use messages to exchange the context you need.",
			);
		routes.push({
			sessionId: link.controller.sessionId,
			counterpart: {
				agentName: `/${link.controller.threadId}`,
				descendants:
					link.controller.storage === "session" &&
					!detachment(ctx, owner)?.context,
			},
			via: { upstream: owner.upstream },
		});
	}
	return routes;
}

/** Locate only through recorded family edges; probing never executes a Notes operation. */
export async function contextRouteMatches(
	ctx: ExtensionContext,
	identity: ContextAgentIdentity,
	agentName: string,
	visited: string[],
	fleet: AgentFleet,
	signal?: AbortSignal,
): Promise<{ route: ContextRoute; count: number }[]> {
	return Promise.all(
		contextRoutes(ctx, identity, visited).map(async (route) => {
			if (route.counterpart?.agentName === agentName)
				return { route, count: 1 };
			if (route.counterpart && !route.counterpart.descendants)
				return { route, count: 0 };
			try {
				const count = await sendContextRoute(
					fleet,
					route,
					{
						operation: "context-resolve",
						sessionId: route.sessionId,
						agentName,
						visited,
					},
					signal,
				);
				if (
					typeof count !== "number" ||
					!Number.isSafeInteger(count) ||
					count < 0
				)
					throw new Error(
						"Shared agent lookup is unavailable; update and restart participating sessions",
					);
				return { route, count };
			} catch (error) {
				signal?.throwIfAborted();
				if (!isContextUnavailable(error)) throw error;
				return { route, count: 0 };
			}
		}),
	);
}

export async function countContextTargets(
	ctx: ExtensionContext,
	identity: ContextAgentIdentity,
	input: Record<string, unknown>,
	fleet: AgentFleet,
	signal?: AbortSignal,
): Promise<number> {
	if (
		input["sessionId"] !== identity.sessionId ||
		typeof input["agentName"] !== "string" ||
		!Array.isArray(input["visited"]) ||
		input["visited"].some((id) => typeof id !== "string") ||
		input["visited"].length >= 64 ||
		input["visited"].includes(identity.threadId)
	)
		throw new Error("Invalid shared context lookup or session family");
	const matches = await contextRouteMatches(
		ctx,
		identity,
		input["agentName"],
		[...input["visited"], identity.threadId],
		fleet,
		signal,
	);
	return matches.reduce(
		(total, match) => total + match.count,
		identity.agentName === input["agentName"] ? 1 : 0,
	);
}
