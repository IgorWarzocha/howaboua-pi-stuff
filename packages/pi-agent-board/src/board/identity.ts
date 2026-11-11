import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	bool,
	compile,
	lit,
	nul,
	obj,
	opt,
	type Static,
	str,
	union,
} from "@earendil-works/pi-schema";
import { readBoardConfig } from "./config.js";

const nativeId = str({ pattern: "^[a-zA-Z0-9_.-]+$" });
export const BindingSchema = obj(
	{
		protocol: lit(1),
		boardId: nativeId,
		rootSessionId: nativeId,
		sessionId: nativeId,
		agentName: str({
			pattern: "^/[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_-]+)*$",
		}),
		legacyAgentName: opt(str({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" })),
		parentSessionId: opt(nativeId),
		ownerFolder: str({ minLength: 1 }),
		databasePath: str({ minLength: 1 }),
		enabled: bool(),
		upstream: opt(str({ minLength: 1 })),
	},
	{ open: false },
);
export type BoardBinding = Static<typeof BindingSchema>;
const ChildSchema = obj(
	{
		parentSessionId: nativeId,
		binding: BindingSchema,
		machine: str(),
		sessionFile: str({ minLength: 1 }),
	},
	{ open: true },
);
type BoardChild = Static<typeof ChildSchema>;
const BINDING = "shepherdr-board-binding";
const MEMBER = "shepherdr-board-member";
const CHILD = "shepherdr-board-child";
const SETTING = "shepherdr-board-setting";
const defaults = new WeakMap<ExtensionContext["sessionManager"], boolean>();
const bindingSchemaValidator = compile(BindingSchema);
const childSchemaValidator = compile(ChildSchema);

export function setBoardDefault(ctx: ExtensionContext, enabled: boolean) {
	defaults.set(ctx.sessionManager, enabled);
}
const REMOVED = "shepherdr-board-removed";
const SettingSchema = obj(
	{
		sessionId: nativeId,
		enabled: union([bool(), nul()]),
	},
	{ open: true },
);
const settingSchemaValidator = compile(SettingSchema);

function sessionBoardSetting(ctx: ExtensionContext): boolean | undefined {
	let enabled: boolean | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SETTING) continue;
		if (!settingSchemaValidator.check(entry.data))
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
	if (!bindingSchemaValidator.check(value))
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
		if (!childSchemaValidator.check(entry.data))
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
		else if (
			entry.customType === CHILD &&
			childSchemaValidator.check(entry.data)
		)
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
