import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BoardEnvelope } from "@howaboua/pi-agent-comms/integration";
import {
	type BoardBinding,
	binding,
	children,
	members,
	parseBinding,
	removeMember,
	saveBinding,
	saveChild,
	saveMember,
} from "@howaboua/pi-agent-comms/integration";
import type { ConnectedMachine } from "../fleet/index.js";

function sameMembership(left: BoardBinding, right: BoardBinding) {
	const { legacyAgentName: _left, ...a } = parseBinding(left);
	const { legacyAgentName: _right, ...b } = parseBinding(right);
	return isDeepStrictEqual({ ...a, enabled: false }, { ...b, enabled: false });
}

function adoptedBinding(desired: BoardBinding, sessionId: string) {
	return parseBinding({
		...desired,
		sessionId,
		parentSessionId: desired.parentSessionId ?? desired.sessionId,
	});
}

/** Owns board attachment adoption, registration, restoration and removal. */
export class BoardMembership {
	private readonly pi: ExtensionAPI;
	private readonly toOwner: (
		ctx: ExtensionContext,
		request: BoardEnvelope,
	) => Promise<unknown>;
	private readonly getActive: () => Map<string, unknown>;
	constructor(
		pi: ExtensionAPI,
		toOwner: (
			ctx: ExtensionContext,
			request: BoardEnvelope,
		) => Promise<unknown>,
		getActive: () => Map<string, unknown>,
	) {
		this.pi = pi;
		this.toOwner = toOwner;
		this.getActive = getActive;
	}
	inspectAttachment(ctx: ExtensionContext) {
		this.getActive();
		const own = binding(ctx);
		if (own.upstream || children(ctx).length || members(ctx).length > 1)
			throw new Error("Target already owns or belongs to a board family");
		return own;
	}
	prepareAttachment(
		ctx: ExtensionContext,
		upstream: string,
		targetSessionId: string,
	) {
		this.getActive();
		const own = binding(ctx);
		if (!own.enabled)
			throw new Error(
				"Enable the controller's board before attaching a member",
			);
		if (!ctx.sessionManager.getSessionFile())
			throw new Error("Board attachment requires a saved controller session");
		const { legacyAgentName: _legacy, ...board } = own;
		return {
			...board,
			upstream,
			sessionId: targetSessionId,
			agentName: `/${targetSessionId}`,
			parentSessionId: own.sessionId,
		};
	}
	commitAttachment(
		ctx: ExtensionContext,
		expected: BoardBinding,
		desired: BoardBinding,
	) {
		this.getActive();
		if (!ctx.isIdle())
			throw new Error("Attach a board only after the target settles");
		const own = binding(ctx);
		const adopted = adoptedBinding(desired, own.sessionId);
		if (isDeepStrictEqual(own, adopted)) return adopted;
		if (!sameMembership(this.inspectAttachment(ctx), expected))
			throw new Error(
				"Target board changed during attachment; resolve it again",
			);
		saveBinding(this.pi, adopted);
		return adopted;
	}
	async registerAttachment(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		sessionFile: string,
		adopted: BoardBinding,
		expected: BoardBinding,
	) {
		this.getActive();
		if (!sameMembership(binding(ctx), expected))
			throw new Error("Controller board changed during attachment");
		saveBinding(this.pi, parseBinding(expected));
		await this.toOwner(ctx, {
			operation: "board-register",
			caller: parseBinding(expected),
			member: parseBinding({ ...adopted, parentSessionId: expected.sessionId }),
		});
		if (!sameMembership(binding(ctx), expected))
			throw new Error("Controller board changed during attachment");
		saveChild(this.pi, {
			parentSessionId: expected.sessionId,
			binding: parseBinding({
				...adopted,
				parentSessionId: expected.sessionId,
			}),
			machine: runtime.machine,
			sessionFile,
		});
	}
	detachTarget(
		ctx: ExtensionContext,
		desired: BoardBinding,
		previous: BoardBinding,
	) {
		this.getActive();
		if (children(ctx).length)
			throw new Error(
				"Detach a board member only when it has no board children",
			);
		if (
			!sameMembership(binding(ctx), adoptedBinding(desired, previous.sessionId))
		)
			throw new Error("Target board changed before detach");
		saveBinding(this.pi, previous);
		this.getActive().clear();
	}
	async unregisterAttachment(ctx: ExtensionContext, member: BoardBinding) {
		this.getActive();
		const own = binding(ctx);
		await this.toOwner(ctx, {
			operation: "board-unregister",
			caller: own,
			member: parseBinding({ ...member, parentSessionId: own.sessionId }),
		});
		if (!sameMembership(binding(ctx), own))
			throw new Error("Controller board changed during detach");
		removeMember(this.pi, member);
	}
	commitDirectory(
		own: BoardBinding,
		directory: BoardBinding[],
		caller: BoardBinding,
		request: Extract<
			BoardEnvelope,
			{ operation: "board-register" | "board-unregister" }
		>,
	) {
		if (request.operation === "board-unregister") {
			const member = parseBinding(request.member);
			if (
				member.boardId !== own.boardId ||
				member.databasePath !== own.databasePath ||
				member.parentSessionId !== caller.sessionId
			)
				throw new Error("Invalid board member removal");
			if (directory.some((entry) => entry.parentSessionId === member.sessionId))
				throw new Error(
					"Detach a board member only when it has no board children",
				);
			const existing = directory.find(
				(entry) => entry.agentName === member.agentName,
			);
			if (
				existing &&
				(existing.parentSessionId !== caller.sessionId ||
					!sameMembership(existing, member))
			)
				throw new Error("Board member changed before detach");
			removeMember(this.pi, member);
			this.getActive().delete(member.agentName);
			return true;
		}
		if (request.operation === "board-register") {
			const member = parseBinding(request.member);
			if (
				member.boardId !== own.boardId ||
				member.databasePath !== own.databasePath ||
				member.rootSessionId !== own.rootSessionId ||
				member.parentSessionId !== caller.sessionId
			)
				throw new Error("Invalid board member registration");
			const existing = directory.find(
				(entry) =>
					entry.agentName === member.agentName ||
					entry.sessionId === member.sessionId,
			);
			if (existing && sameMembership(existing, member)) return true;
			if (existing) throw new Error("Board member already bound");
			saveMember(this.pi, member);
			return true;
		}
	}
}
