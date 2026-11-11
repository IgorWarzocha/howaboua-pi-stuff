import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	compile,
	lit,
	obj,
	opt,
	type Static,
	str,
	union,
	unknown,
} from "@earendil-works/pi-schema";
import type { SharedContextResult } from "@howaboua/pi-agent-comms/context-sharing";
import { BindingSchema } from "./board/records.js";

const AgentPath = str({
	pattern: "^/(?:[a-zA-Z0-9_.-]+|root(?:/[a-zA-Z0-9_-]+)*)$",
});
export const Identity = obj(
	{
		protocol: {
			...lit(1),
			type: "number",
		},
		sessionId: str({ minLength: 1 }),
		threadId: str({ minLength: 1 }),
		agentName: AgentPath,
		storageAgentName: opt(AgentPath),
		storage: union([
			{
				...lit("session"),
				type: "string",
			},
			{
				...lit("remote"),
				type: "string",
			},
		]),
		accountScope: opt(str({ pattern: "^[a-f0-9]{64}$" })),
		backendUrl: opt(str({ minLength: 1 })),
		routing: opt(unknown()),
	},
	{ open: true },
);
export const checkIdentity = compile(Identity).check;
// Persisted attachment records predate native agent references. Keep their storage address.
export function canonicalContextIdentity(
	identity: Static<typeof Identity>,
): Static<typeof Identity> {
	const agentName = `/${identity.threadId}`;
	return identity.agentName === agentName
		? identity
		: {
				...identity,
				agentName,
				storageAgentName: identity.storageAgentName ?? identity.agentName,
			};
}
const ContextLink = obj(
	{
		controller: Identity,
		target: Identity,
		alias: AgentPath,
		controllerAlias: AgentPath,
		controllerFile: opt(str()),
		controllerMachine: opt(str({ minLength: 1 })),
		controllerNotes: unknown(),
		targetNotes: unknown(),
	},
	{ open: true },
);
const Plan = obj({
	controllerSessionId: str({ minLength: 1 }),
	targetSessionId: str({ minLength: 1 }),
	upstream: str({ minLength: 1 }),
	context: opt(ContextLink),
	board: opt(
		obj(
			{
				previous: BindingSchema,
				desired: BindingSchema,
				controller: BindingSchema,
			},
			{ open: true },
		),
	),
});
export const checkPlan = compile(Plan).check;
const Route = obj(
	{
		plan: Plan,
		machine: str(),
		sessionFile: str({ minLength: 1 }),
		phase: union([
			{
				...lit("pending"),
				type: "string",
			},
			{
				...lit("ready"),
				type: "string",
			},
		]),
		detached: opt(
			obj(
				{
					context: opt(unknown()),
					board: opt({
						...lit(true),
						type: "boolean",
					}),
				},
				{ open: true },
			),
		),
	},
	{ open: true },
);
const checkRoute = compile(Route).check;
export const Snapshot = obj(
	{
		sessionId: str({ minLength: 1 }),
		board: BindingSchema,
		context: opt(Identity),
		notes: opt(unknown()),
		contextError: opt(str()),
		boardError: opt(str()),
	},
	{ open: true },
);
export const checkSnapshot = compile(Snapshot).check;
export type AttachmentPlan = Static<typeof Plan>;
export type AttachmentRoute = Static<typeof Route>;
export const OWNER = "shepherdr-attachment-owner";
export const ROUTE = "shepherdr-attachment-route";
export const DETACHED = "shepherdr-attachment-detached";
export const Detachment = obj(
	{
		plan: Plan,
		context: opt(unknown()),
		board: opt({
			...lit(true),
			type: "boolean",
		}),
	},
	{ open: true },
);
export const checkDetachment = compile(Detachment).check;
function saved<T>(
	ctx: ExtensionContext,
	key: string,
	check: (value: unknown) => value is T,
): T[] {
	return ctx.sessionManager.getEntries().flatMap((entry) => {
		if (entry.type !== "custom" || entry.customType !== key) return [];
		if (!check(entry.data)) throw new Error("Invalid saved agent attachment");
		return [entry.data];
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
	const remapField = (key: string, value: unknown) =>
		(key === "path" || key === "agent_name") && typeof value === "string"
			? remap(value, from, to)
			: value;
	const structured =
		result.structuredContent === undefined
			? {}
			: {
					structuredContent: JSON.parse(
						JSON.stringify(result.structuredContent),
						remapField,
					),
				};
	if (
		typeof result.details.codexHistoryNotes["encrypted_output"] === "string" ||
		("externalNotesResponses" in result.details &&
			Array.isArray(result.details.externalNotesResponses) &&
			result.details.externalNotesResponses.length > 0)
	) {
		const hint = `Source ${from}, access through ${to}. Use ${to}/notes for note paths and ${to} for history agent_name`;
		// Ciphertext paths cannot be remapped. Preserve host-only provenance on the original details.
		result.details.codexHistoryNotes["attachment_hint"] = hint;
		return {
			...result,
			...structured,
			content: [{ type: "text", text: hint }, ...result.content],
		};
	}
	const details = JSON.parse(
		JSON.stringify(result.details.codexHistoryNotes),
		remapField,
	) as Record<string, unknown>;
	return {
		...result,
		...structured,
		// Remap the public payload, never regenerate it from private receipts.
		content: result.content.map((item) => {
			if (item.type !== "text") return item;
			try {
				return {
					...item,
					text: JSON.stringify(JSON.parse(item.text, remapField)),
				};
			} catch {
				return item;
			}
		}),
		details: { ...result.details, codexHistoryNotes: details },
	};
}

export function detachment(ctx: ExtensionContext, plan: AttachmentPlan) {
	return saved(ctx, DETACHED, checkDetachment).findLast((entry) =>
		isDeepStrictEqual(entry.plan, plan),
	);
}
export function attachmentOwner(ctx: ExtensionContext) {
	return saved(ctx, OWNER, checkPlan).findLast(
		(plan) => plan.targetSessionId === ctx.sessionManager.getSessionId(),
	);
}
export function attachmentRoutes(ctx: ExtensionContext) {
	const found = new Map<string, AttachmentRoute>();
	for (const route of saved(ctx, ROUTE, checkRoute))
		if (route.plan.controllerSessionId === ctx.sessionManager.getSessionId())
			found.set(route.sessionFile + "\0" + route.machine, route);
	return [...found.values()];
}
