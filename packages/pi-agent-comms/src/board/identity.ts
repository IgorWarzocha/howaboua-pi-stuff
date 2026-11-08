import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { readBoardConfig } from "./config.js";

const nativeId = Type.String({ pattern: "^[a-zA-Z0-9_.-]+$" });
export const BindingSchema = Type.Object(
	{
		protocol: Type.Literal(1),
		boardId: nativeId,
		rootSessionId: nativeId,
		sessionId: nativeId,
		agentName: Type.String({
			pattern: "^/[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_-]+)*$",
		}),
		legacyAgentName: Type.Optional(
			Type.String({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" }),
		),
		parentSessionId: Type.Optional(nativeId),
		ownerFolder: Type.String({ minLength: 1 }),
		databasePath: Type.String({ minLength: 1 }),
		enabled: Type.Boolean(),
		upstream: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type BoardBinding = Static<typeof BindingSchema>;
const ChildSchema = Type.Object({
	parentSessionId: nativeId,
	binding: BindingSchema,
	machine: Type.String(),
	sessionFile: Type.String({ minLength: 1 }),
});
type BoardChild = Static<typeof ChildSchema>;
const BINDING = "shepherdr-board-binding";
const MEMBER = "shepherdr-board-member";
const CHILD = "shepherdr-board-child";
const SETTING = "shepherdr-board-setting";
const defaults = new WeakMap<ExtensionContext["sessionManager"], boolean>();
export function setBoardDefault(ctx: ExtensionContext, enabled: boolean) {
	defaults.set(ctx.sessionManager, enabled);
}
const REMOVED = "shepherdr-board-removed";
const SettingSchema = Type.Object({
	sessionId: nativeId,
	enabled: Type.Union([Type.Boolean(), Type.Null()]),
});

function sessionBoardSetting(ctx: ExtensionContext): boolean | undefined {
	let enabled: boolean | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SETTING) continue;
		if (!Check(SettingSchema, entry.data))
			throw new Error("Invalid saved board setting");
		const value = entry.data as Static<typeof SettingSchema>;
		if (value.sessionId === ctx.sessionManager.getSessionId())
			enabled = value.enabled ?? undefined;
	}
	return enabled;
}

export function saveBoardSetting(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	enabled: boolean,
) {
	pi.appendEntry(SETTING, {
		sessionId: ctx.sessionManager.getSessionId(),
		enabled,
	});
}

export function rootBoardSetting(ctx: ExtensionContext) {
	try {
		const config = readBoardConfig(
			resolve(ctx.sessionManager.getCwd()),
			defaults.get(ctx.sessionManager),
		);
		const session = sessionBoardSetting(ctx);
		return {
			enabled: session ?? config.folder ?? config.global,
			source:
				session !== undefined
					? "session"
					: config.folder !== undefined
						? "folder"
						: "global default",
		};
	} catch (error) {
		return {
			enabled: false,
			source: "invalid configuration",
			error: String(error),
		};
	}
}

export function parseBinding(value: unknown): BoardBinding {
	if (!Check(BindingSchema, value))
		throw new Error("Invalid Shepherdr board binding");
	const saved = value as BoardBinding;
	assertSessionIdentity(saved.sessionId, saved.rootSessionId);
	const agentName = `/${saved.sessionId}`;
	if (saved.agentName !== agentName && !/^\/root(?:\/|$)/.test(saved.agentName))
		throw new Error("Board agent reference does not match its native session");
	return {
		...saved,
		agentName,
		...(saved.agentName !== agentName && !saved.legacyAgentName
			? { legacyAgentName: saved.agentName }
			: {}),
	};
}
export function binding(ctx: ExtensionContext): BoardBinding {
	const sessionId = ctx.sessionManager.getSessionId();
	assertSessionIdentity(sessionId);
	let saved: BoardBinding | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== BINDING) continue;
		const candidate = parseBinding(entry.data);
		if (candidate.sessionId === sessionId) saved = candidate;
	}
	const ownerFolder = resolve(ctx.sessionManager.getCwd());
	if (saved?.upstream) return saved;
	return {
		...(saved ?? {
			protocol: 1,
			sessionId,
			rootSessionId: sessionId,
			boardId: sessionId,
			agentName: `/${sessionId}`,
			ownerFolder,
			databasePath: resolve(ownerFolder, ".pi", "agent-message-board.sqlite"),
			enabled: false,
		}),
		enabled: rootBoardSetting(ctx).enabled,
	};
}
function assertSessionIdentity(...ids: string[]) {
	if (ids.includes("root"))
		throw new Error(
			"Pi session ID root conflicts with the legacy /root reference; start a session with another ID",
		);
}
export function saveBinding(pi: ExtensionAPI, value: BoardBinding) {
	pi.appendEntry(BINDING, value);
}
export function members(ctx: ExtensionContext): BoardBinding[] {
	const own = binding(ctx);
	const found = new Map([[own.sessionId, own]]);
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === REMOVED) {
			const value = parseBinding(entry.data);
			if (value.boardId === own.boardId) found.delete(value.sessionId);
			continue;
		}
		if (entry.type !== "custom" || entry.customType !== MEMBER) continue;
		const value = parseBinding(entry.data);
		if (value.rootSessionId === own.sessionId && value.boardId === own.boardId)
			found.set(value.sessionId, value);
	}
	const directory = [...found.values()];
	return directory.map((member) => {
		if (member.parentSessionId || !member.legacyAgentName) return member;
		const path = member.legacyAgentName;
		const parent = directory.find(
			(entry) =>
				(entry.legacyAgentName ??
					(entry.sessionId === own.rootSessionId ? "/root" : undefined)) ===
				path.slice(0, path.lastIndexOf("/")),
		);
		return parent ? { ...member, parentSessionId: parent.sessionId } : member;
	});
}
export function saveMember(pi: ExtensionAPI, value: BoardBinding) {
	pi.appendEntry(MEMBER, value);
}
export function children(ctx: ExtensionContext): BoardChild[] {
	const own = binding(ctx);
	const found = new Map<string, BoardChild>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === REMOVED) {
			const value = parseBinding(entry.data);
			if (value.boardId === own.boardId) found.delete(value.sessionId);
			continue;
		}
		if (entry.type !== "custom" || entry.customType !== CHILD) continue;
		if (!Check(ChildSchema, entry.data))
			throw new Error("Invalid saved board child route");
		const value = entry.data as BoardChild;
		if (
			value.parentSessionId === own.sessionId &&
			value.binding.boardId === own.boardId
		)
			found.set(value.binding.sessionId, {
				...value,
				binding: parseBinding(value.binding),
			});
	}
	return [...found.values()];
}
export function saveChild(pi: ExtensionAPI, value: BoardChild) {
	pi.appendEntry(CHILD, value);
}
export function removeMember(pi: ExtensionAPI, value: BoardBinding) {
	pi.appendEntry(REMOVED, value);
}

/** Legacy names are aliases from native-session records, never access grants. */
export function boardAliases(
	ctx: ExtensionContext,
	boardId = binding(ctx).boardId,
): [string, string][] {
	const own = binding(ctx);
	const aliases = new Map<string, string>();
	if (own.boardId === boardId && own.sessionId === own.rootSessionId)
		aliases.set("/root", own.agentName);
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom") continue;
		let member: BoardBinding;
		if ([BINDING, MEMBER, REMOVED].includes(entry.customType))
			member = parseBinding(entry.data);
		else if (entry.customType === CHILD && Check(ChildSchema, entry.data))
			member = parseBinding((entry.data as BoardChild).binding);
		else continue;
		if (member.boardId === boardId && member.legacyAgentName) {
			const previous = aliases.get(member.legacyAgentName);
			if (previous && previous !== member.agentName)
				throw new Error("Ambiguous saved board agent reference");
			aliases.set(member.legacyAgentName, member.agentName);
		}
	}
	return [...aliases];
}
