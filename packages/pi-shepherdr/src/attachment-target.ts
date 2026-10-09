import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { binding } from "@howaboua/pi-agent-board/integration";
import type { ContextSharingService } from "@howaboua/pi-codex-conversion/context-sharing";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import { AttachmentNotes } from "./attachment-notes.js";
import {
	type AttachmentPlan,
	attachmentOwner,
	attachmentRoutes,
	DETACHED,
	Detachment,
	detachment,
	Identity,
	OWNER,
	Plan,
} from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import { sendPolicyMessage } from "./delivery.js";
import { attachmentMessage, detachmentMessage } from "./messages.js";

/** Validates and commits attachment membership in the settled target session. */
export class AttachmentTarget {
	private readonly pi: ExtensionAPI;
	private readonly board: AgentBoard;
	private readonly getService: () => ContextSharingService | undefined;
	private readonly notes: AttachmentNotes;
	constructor(
		pi: ExtensionAPI,
		board: AgentBoard,
		getService: () => ContextSharingService | undefined,
		notes: AttachmentNotes,
	) {
		this.pi = pi;
		this.board = board;
		this.getService = getService;
		this.notes = notes;
	}
	async context(ctx: ExtensionContext, target: boolean) {
		const service = this.getService();
		if (!service?.inspectAttachment || !service.retainAttachmentIdentity)
			throw new Error("Update Codex Conversion to attach existing context");
		const identity = await service.inspectAttachment(ctx, target);
		if (!identity || !Check(Identity, identity))
			throw new Error(
				"Context attachment requires notes-based continuity on both agents",
			);
		return identity as Static<typeof Identity>;
	}
	retainIdentity(ctx: ExtensionContext) {
		const service = this.getService();
		if (!service?.retainAttachmentIdentity)
			throw new Error(
				"Context attachment support became unavailable; reload and retry",
			);
		return service.retainAttachmentIdentity(ctx);
	}
	private async inspect(ctx: ExtensionContext) {
		if (!ctx.isIdle()) throw new Error("Attach only after the target settles");
		if (!ctx.sessionManager.getSessionFile())
			throw new Error("Attachment requires a saved target session");
		let context: Static<typeof Identity> | undefined;
		let contextError: string | undefined;
		let boardError: string | undefined;
		try {
			context = await this.context(ctx, true);
			if (
				attachmentRoutes(ctx).some((route) => route.plan.context) ||
				ctx.sessionManager
					.getEntries()
					.some(
						(entry) =>
							entry.type === "custom" &&
							entry.customType === "herdr-context-child" &&
							(entry.data as { threadId?: unknown } | undefined)?.threadId ===
								context?.threadId,
					)
			)
				throw new Error("Target already controls a context family");
		} catch (error) {
			context = undefined;
			contextError = String(error);
		}
		try {
			this.board.membership.inspectAttachment(ctx);
		} catch (error) {
			boardError = String(error);
		}
		return {
			sessionId: ctx.sessionManager.getSessionId(),
			board: binding(ctx),
			...(context ? { context, notes: await this.notes.export(ctx) } : {}),
			...(contextError ? { contextError } : {}),
			...(boardError ? { boardError } : {}),
		};
	}
	async handle(
		ctx: ExtensionContext,
		input: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		signal?.throwIfAborted();
		if (!input || typeof input !== "object" || !("operation" in input))
			throw new Error("Invalid attachment request");
		if (input.operation === "attach-inspect") return this.inspect(ctx);
		if (input.operation === "attachment-export-notes") {
			if (
				!("plan" in input) ||
				!Check(Plan, input.plan) ||
				!isDeepStrictEqual(attachmentOwner(ctx), input.plan)
			)
				throw new Error("Invalid checkpoint owner");
			return this.notes.export(ctx);
		}
		if (input.operation === "detach-commit")
			return this.commitDetach(ctx, input, signal);
		if (
			input.operation !== "attach-commit" ||
			!("plan" in input) ||
			!Check(Plan, input.plan)
		)
			throw new Error("Invalid attachment request");
		const plan = input.plan as AttachmentPlan;
		if (plan.board) this.board.requireAvailable();
		if (
			(!plan.context && !plan.board) ||
			plan.controllerSessionId === plan.targetSessionId ||
			(plan.context &&
				(plan.context.controller.threadId !== plan.controllerSessionId ||
					plan.context.target.threadId !== plan.targetSessionId ||
					!plan.context.alias.startsWith(
						`${plan.context.controller.agentName}/`,
					) ||
					!plan.context.controllerAlias.startsWith(
						`${plan.context.target.agentName}/`,
					))) ||
			(plan.board &&
				(plan.board.controller.sessionId !== plan.controllerSessionId ||
					plan.board.previous.sessionId !== plan.targetSessionId ||
					!isDeepStrictEqual(plan.board.desired, {
						...plan.board.controller,
						agentName: plan.board.desired.agentName,
						upstream: plan.upstream,
					}) ||
					!plan.board.desired.agentName.startsWith(
						`${plan.board.controller.agentName}/`,
					)))
		)
			throw new Error("Invalid attachment identities or routes");
		if (
			!ctx.isIdle() ||
			ctx.sessionManager.getSessionId() !== plan.targetSessionId
		)
			throw new Error(
				"Target changed or started work during attachment; retry after it settles",
			);
		const owner = attachmentOwner(ctx);
		if (owner && detachment(ctx, owner))
			throw new Error("Attachment was detached; reattachment is unsupported");
		if (owner && !isDeepStrictEqual(owner, plan))
			throw new Error(
				"Target is already attached; another controller or different attachment choices are unsupported",
			);
		if (!owner) {
			const current = await this.inspect(ctx);
			if (
				plan.context &&
				(!current.context ||
					!isDeepStrictEqual(current.context, plan.context.target))
			)
				throw new Error(
					current.contextError ?? "Target context changed during attachment",
				);
			if (plan.board && current.boardError) throw new Error(current.boardError);
			if (plan.board && !isDeepStrictEqual(current.board, plan.board.previous))
				throw new Error("Target board changed during attachment");
			// Authentication completes before either membership mutation.
			if (plan.context) {
				await this.notes.verify(
					ctx,
					plan.context.controllerNotes,
					plan.context.controller,
				);
				this.notes.validate(plan.context.targetNotes, plan.context.target);
			}
			if (plan.context) {
				const identity = await this.context(ctx, true);
				signal?.throwIfAborted();
				if (
					!ctx.isIdle() ||
					ctx.sessionManager.getSessionId() !== plan.targetSessionId ||
					!isDeepStrictEqual(identity, plan.context.target) ||
					(plan.board && !isDeepStrictEqual(binding(ctx), plan.board.previous))
				)
					throw new Error(
						"Target changed during attachment authentication; retry after it settles",
					);
				this.retainIdentity(ctx);
			}
			signal?.throwIfAborted();
			if (
				!ctx.isIdle() ||
				ctx.sessionManager.getSessionId() !== plan.targetSessionId
			)
				throw new Error(
					"Target changed during attachment; retry after it settles",
				);
			if (plan.board)
				this.board.membership.commitAttachment(
					ctx,
					plan.board.previous,
					plan.board.desired,
				);
			this.pi.appendEntry(OWNER, plan);
			sendPolicyMessage(
				this.pi,
				attachmentMessage(
					plan.context?.controllerAlias,
					plan.board?.desired.agentName,
				),
				{ triggerTurn: false },
			);
		} else {
			if (
				plan.context &&
				!isDeepStrictEqual(await this.context(ctx, false), plan.context.target)
			)
				throw new Error(
					"Shared notes are unavailable. Use messages to exchange the context you need.",
				);
			if (
				plan.board &&
				!isDeepStrictEqual(binding(ctx), {
					...plan.board.desired,
					sessionId: plan.targetSessionId,
				})
			)
				throw new Error("Attached board changed; resolve the target again");
		}
		if (plan.board) await this.board.refresh(ctx);
		if (ctx.sessionManager.getSessionId() !== plan.targetSessionId)
			throw new Error(
				"Target session changed after attachment; resume it and retry",
			);
		return plan;
	}
	private async commitDetach(
		ctx: ExtensionContext,
		input: unknown,
		signal?: AbortSignal,
	) {
		if (!Check(Detachment, input)) throw new Error("Invalid detach request");
		const requested = input as Static<typeof Detachment>;
		if (requested.board) this.board.requireAvailable();
		const { plan } = requested;
		if (
			!isDeepStrictEqual(attachmentOwner(ctx), plan) ||
			ctx.sessionManager.getSessionId() !== plan.targetSessionId ||
			!ctx.isIdle()
		)
			throw new Error("Detach requires the original settled target session");
		if (
			(!requested.context && !requested.board) ||
			(requested.context && !plan.context) ||
			(requested.board && !plan.board)
		)
			throw new Error("Invalid detach choices");
		const previous = detachment(ctx, plan);
		if (requested.context && plan.context) {
			if (
				!isDeepStrictEqual(await this.context(ctx, false), plan.context.target)
			)
				throw new Error("Target context changed before detach");
			this.notes.validate(requested.context, plan.context.controller);
			await this.notes.verify(
				ctx,
				requested.context,
				plan.context.controller,
				true,
			);
		}
		const ownNotes = requested.context
			? await this.notes.export(ctx)
			: undefined;
		if (ownNotes) this.notes.checkTransport(ownNotes);
		signal?.throwIfAborted();
		if (
			!ctx.isIdle() ||
			ctx.sessionManager.getSessionId() !== plan.targetSessionId ||
			!isDeepStrictEqual(attachmentOwner(ctx), plan)
		)
			throw new Error(
				"Target changed during detach authentication; retry after it settles",
			);
		if (requested.board && plan.board && !previous?.board)
			this.board.membership.detachTarget(
				ctx,
				plan.board.desired,
				plan.board.previous,
			);
		this.pi.appendEntry(DETACHED, { ...previous, ...requested });
		const contextAlias =
			requested.context && !previous?.context
				? plan.context?.controllerAlias
				: undefined;
		const restoredBoard =
			requested.board && !previous?.board ? plan.board?.previous : undefined;
		if (contextAlias || restoredBoard)
			sendPolicyMessage(
				this.pi,
				detachmentMessage(contextAlias, restoredBoard),
				{ triggerTurn: false },
			);
		if (requested.board) await this.board.refresh(ctx);
		if (ctx.sessionManager.getSessionId() !== plan.targetSessionId)
			throw new Error("Target changed after detach; resume it and retry");
		return { detached: true, ...(ownNotes ? { notes: ownNotes } : {}) };
	}
}
