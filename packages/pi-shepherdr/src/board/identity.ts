import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import { readBoardConfig } from "./config.js";

const uuid = Type.String({ pattern: "^[a-f0-9-]{36}$" });
export const BindingSchema = Type.Object(
	{
		protocol: Type.Literal(1),
		boardId: uuid,
		rootSessionId: uuid,
		sessionId: uuid,
		agentName: Type.String({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" }),
		ownerFolder: Type.String({ minLength: 1 }),
		databasePath: Type.String({ minLength: 1 }),
		enabled: Type.Boolean(),
		upstream: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type BoardBinding = Static<typeof BindingSchema>;
const ChildSchema = Type.Object({
	parentSessionId: uuid,
	binding: BindingSchema,
	machine: Type.String(),
	sessionFile: Type.String({ minLength: 1 }),
});
export type BoardChild = Static<typeof ChildSchema>;
const BINDING = "shepherdr-board-binding";
const MEMBER = "shepherdr-board-member";
const CHILD = "shepherdr-board-child";
const SETTING = "shepherdr-board-setting";
const SettingSchema = Type.Object({
	sessionId: uuid,
	enabled: Type.Union([Type.Boolean(), Type.Null()]),
});

export function sessionBoardSetting(
	ctx: ExtensionContext,
): boolean | undefined {
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
	enabled: boolean | undefined,
) {
	pi.appendEntry(SETTING, {
		sessionId: ctx.sessionManager.getSessionId(),
		enabled: enabled ?? null,
	});
}

export function rootBoardSetting(ctx: ExtensionContext) {
	try {
		const config = readBoardConfig(resolve(ctx.sessionManager.getCwd()));
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
	return value as BoardBinding;
}
export function binding(ctx: ExtensionContext): BoardBinding {
	const sessionId = ctx.sessionManager.getSessionId();
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
			agentName: "/root",
			ownerFolder,
			databasePath: resolve(ownerFolder, ".pi", "agent-message-board.sqlite"),
			enabled: false,
		}),
		enabled: rootBoardSetting(ctx).enabled,
	};
}
export function saveBinding(pi: ExtensionAPI, value: BoardBinding) {
	pi.appendEntry(BINDING, value);
}
export function members(ctx: ExtensionContext): BoardBinding[] {
	const own = binding(ctx);
	const found = new Map([[own.agentName, own]]);
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== MEMBER) continue;
		const value = parseBinding(entry.data);
		if (value.rootSessionId === own.sessionId && value.boardId === own.boardId)
			found.set(value.agentName, value);
	}
	return [...found.values()];
}
export function saveMember(pi: ExtensionAPI, value: BoardBinding) {
	pi.appendEntry(MEMBER, value);
}
export function children(ctx: ExtensionContext): BoardChild[] {
	const own = binding(ctx);
	const found = new Map<string, BoardChild>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== CHILD) continue;
		if (!Check(ChildSchema, entry.data))
			throw new Error("Invalid saved board child route");
		const value = entry.data as BoardChild;
		if (
			value.parentSessionId === own.sessionId &&
			value.binding.boardId === own.boardId
		)
			found.set(value.binding.agentName, value);
	}
	return [...found.values()];
}
export function saveChild(pi: ExtensionAPI, value: BoardChild) {
	pi.appendEntry(CHILD, value);
}
