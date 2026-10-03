import { isDeepStrictEqual } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SharedContextResult } from "@howaboua/pi-codex-conversion/context-sharing";
import type { Static, TSchema } from "typebox";
import { Check } from "typebox/value";
import { BindingSchema } from "./board/identity.js";

const AgentPath = Type.String({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" });
export const Identity = Type.Object({
	protocol: Type.Literal(1),
	sessionId: Type.String({ minLength: 1 }),
	threadId: Type.String({ minLength: 1 }),
	agentName: AgentPath,
	storage: Type.Literal("session"),
	routing: Type.Optional(Type.Unknown()),
});
const ContextLink = Type.Object({
	controller: Identity,
	target: Identity,
	alias: AgentPath,
	controllerAlias: AgentPath,
	controllerFile: Type.Optional(Type.String()),
	controllerNotes: Type.Unknown(),
	targetNotes: Type.Unknown(),
});
export const Plan = Type.Object(
	{
		controllerSessionId: Type.String({ minLength: 1 }),
		targetSessionId: Type.String({ minLength: 1 }),
		upstream: Type.String({ minLength: 1 }),
		context: Type.Optional(ContextLink),
		board: Type.Optional(
			Type.Object({
				previous: BindingSchema,
				desired: BindingSchema,
				controller: BindingSchema,
			}),
		),
	},
	{ additionalProperties: false },
);
const Route = Type.Object({
	plan: Plan,
	machine: Type.String(),
	sessionFile: Type.String({ minLength: 1 }),
	phase: Type.Union([Type.Literal("pending"), Type.Literal("ready")]),
	detached: Type.Optional(
		Type.Object({
			context: Type.Optional(Type.Unknown()),
			board: Type.Optional(Type.Literal(true)),
		}),
	),
});
export const Snapshot = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	board: BindingSchema,
	context: Type.Optional(Identity),
	notes: Type.Optional(Type.Unknown()),
	contextError: Type.Optional(Type.String()),
	boardError: Type.Optional(Type.String()),
});
export type AttachmentPlan = Static<typeof Plan>;
export type AttachmentRoute = Static<typeof Route>;
export const OWNER = "shepherdr-attachment-owner";
export const ROUTE = "shepherdr-attachment-route";
export const DETACHED = "shepherdr-attachment-detached";
export const Detachment = Type.Object({
	plan: Plan,
	context: Type.Optional(Type.Unknown()),
	board: Type.Optional(Type.Literal(true)),
});

function saved<T extends TSchema>(
	ctx: ExtensionContext,
	key: string,
	schema: T,
): Static<T>[] {
	return ctx.sessionManager.getEntries().flatMap((entry) => {
		if (entry.type !== "custom" || entry.customType !== key) return [];
		if (!Check(schema, entry.data))
			throw new Error("Invalid saved agent attachment");
		return [entry.data as Static<T>];
	});
}
export function inside(path: string, root: string) {
	return path === root || path.startsWith(`${root}/`);
}
export function remap(value: string, from: string, to: string) {
	return inside(value, from) ? `${to}${value.slice(from.length)}` : value;
}
export function remapParams(
	params: Record<string, unknown>,
	from: string,
	to: string,
) {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key,
			["agent_name", "path", "prefix", "path_prefix"].includes(key) &&
			typeof value === "string"
				? remap(value, from, to)
				: value,
		]),
	);
}
export function remapResult(
	result: SharedContextResult,
	from: string,
	to: string,
): SharedContextResult {
	const details = JSON.parse(
		JSON.stringify(result.details.codexHistoryNotes),
		(key, value: unknown) =>
			(key === "path" || key === "agent_name") && typeof value === "string"
				? remap(value, from, to)
				: value,
	) as Record<string, unknown>;
	return {
		...result,
		content: [{ type: "text", text: JSON.stringify(details) }],
		details: { codexHistoryNotes: details },
	};
}

export function detachment(ctx: ExtensionContext, plan: AttachmentPlan) {
	return saved(ctx, DETACHED, Detachment).findLast((entry) =>
		isDeepStrictEqual(entry.plan, plan),
	);
}
export function attachmentOwner(ctx: ExtensionContext) {
	return saved(ctx, OWNER, Plan).findLast(
		(plan) => plan.targetSessionId === ctx.sessionManager.getSessionId(),
	);
}
export function attachmentRoutes(ctx: ExtensionContext) {
	const found = new Map<string, AttachmentRoute>();
	for (const route of saved(ctx, ROUTE, Route))
		if (route.plan.controllerSessionId === ctx.sessionManager.getSessionId())
			found.set(route.sessionFile + "\0" + route.machine, route);
	return [...found.values()];
}
