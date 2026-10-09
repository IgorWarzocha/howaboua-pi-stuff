import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { binding } from "@howaboua/pi-agent-board/integration";
import type { ContextSharingService } from "@howaboua/pi-codex-conversion/context-sharing";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import type { AgentsParams } from "./agents-contract.js";
import { AttachmentNotes } from "./attachment-notes.js";
import {
	type AttachmentPlan,
	attachmentOwner,
	attachmentRoutes,
	ROUTE,
	Snapshot,
} from "./attachment-protocol.js";
import { AttachmentRouting } from "./attachment-routing.js";
import { AttachmentTarget } from "./attachment-target.js";
import type { AgentBoard } from "./board/host.js";
import type { ConnectedMachine } from "./fleet.js";
import { sessionPath } from "./herdr.js";
import { sessionContextPath } from "./remote/shepherdr-context.mjs";
import type { PaneInfo } from "./types.js";

/** Coordinates retry-safe attach/detach from the controlling session. */
export class AgentAttachment {
	private readonly pi: ExtensionAPI;
	private readonly board: AgentBoard;
	private readonly notes: AttachmentNotes;
	readonly target: AttachmentTarget;
	readonly routing: AttachmentRouting;
	constructor(
		pi: ExtensionAPI,
		board: AgentBoard,
		getService: () => ContextSharingService | undefined,
	) {
		this.pi = pi;
		this.board = board;
		this.notes = new AttachmentNotes(getService);
		this.target = new AttachmentTarget(pi, board, getService, this.notes);
		this.routing = new AttachmentRouting(getService, this.notes);
	}
	async attach(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		panel: PaneInfo,
		params: AgentsParams,
		signal: AbortSignal,
	) {
		if (params.board) this.board.requireAvailable();
		const sessionFile = sessionPath(panel);
		const controllerFile = ctx.sessionManager.getSessionFile();
		const controllerSessionId = ctx.sessionManager.getSessionId();
		if (!sessionFile || !controllerFile)
			throw new Error("Attachment requires saved Pi sessions");
		if (runtime.local && sessionFile === controllerFile)
			throw new Error("Cannot attach this session to itself");
		if (attachmentOwner(ctx))
			throw new Error(
				"An attached agent cannot attach another controller; use its existing controller",
			);
		const context = params.context === true;
		const useBoard = params.board === true;
		const controllerContext = context
			? await this.target.context(ctx, false)
			: undefined;
		const controllerBoard = useBoard ? binding(ctx) : undefined;
		const check = async () => {
			const currentContext = controllerContext
				? await this.target.context(ctx, false)
				: undefined;
			signal.throwIfAborted();
			if (
				ctx.sessionManager.getSessionId() !== controllerSessionId ||
				(controllerContext &&
					!isDeepStrictEqual(currentContext, controllerContext)) ||
				(controllerBoard && !isDeepStrictEqual(binding(ctx), controllerBoard))
			)
				throw new Error(
					"Controller changed during attachment; resume the original session and retry",
				);
		};
		const prior = attachmentRoutes(ctx).find(
			(route) =>
				route.machine === runtime.machine && route.sessionFile === sessionFile,
		);
		if (prior?.detached)
			throw new Error("Attachment was detached; reattachment is unsupported");
		if (
			prior &&
			(!!prior.plan.context !== context || !!prior.plan.board !== useBoard)
		)
			throw new Error(
				"Target has different attachment choices; changing an attachment is unsupported",
			);
		let route = prior;
		if (!route) {
			const snapshot = await runtime.client.requestContext(
				sessionContextPath(sessionFile),
				{ operation: "attach-inspect" },
				signal,
			);
			await check();
			if (!Check(Snapshot, snapshot))
				throw new Error(
					"Target does not support attachment; update and reload Shepherdr",
				);
			const current = snapshot as Static<typeof Snapshot>;
			if (context && !current.context)
				throw new Error(
					current.contextError ?? "Target context is unavailable",
				);
			if (useBoard && current.boardError) throw new Error(current.boardError);
			if (controllerContext && current.context) {
				await this.notes.verify(ctx, current.notes, current.context);
				await check();
			}
			const upstream = runtime.local
				? sessionContextPath(controllerFile)
				: runtime.client.contextRelayPath();
			const segment = `attached-${randomUUID()}`;
			const plan: AttachmentPlan = {
				controllerSessionId,
				targetSessionId: current.sessionId,
				upstream,
				...(controllerContext && current.context
					? {
							context: {
								controller: controllerContext,
								target: current.context,
								alias: `${controllerContext.agentName}/${segment}`,
								controllerAlias: `${current.context.agentName}/controller-${randomUUID()}`,
								...(runtime.local ? { controllerFile } : {}),
								controllerNotes: await this.notes.export(ctx),
								targetNotes: current.notes,
							},
						}
					: {}),
				...(useBoard
					? {
							board: {
								previous: current.board,
								desired: this.board.membership.prepareAttachment(
									ctx,
									upstream,
									segment,
								),
								controller: binding(ctx),
							},
						}
					: {}),
			};
			await check();
			route = { plan, machine: runtime.machine, sessionFile, phase: "pending" };
			this.notes.checkTransport({ operation: "attach-commit", plan });
			// A retry after a lost response reuses the same aliases and board identity.
			this.pi.appendEntry(ROUTE, route);
		}
		try {
			const accepted = await runtime.client.requestContext(
				sessionContextPath(sessionFile),
				{ operation: "attach-commit", plan: route.plan },
				signal,
			);
			await check();
			if (!isDeepStrictEqual(accepted, route.plan))
				throw new Error("Target did not accept the requested attachment");
			if (route.plan.board)
				await this.board.membership.registerAttachment(
					ctx,
					runtime,
					sessionFile,
					{
						...route.plan.board.desired,
						sessionId: route.plan.targetSessionId,
					},
					route.plan.board.controller,
				);
			await check();
			if (route.plan.context) this.target.retainIdentity(ctx);
			if (route.phase !== "ready")
				this.pi.appendEntry(ROUTE, { ...route, phase: "ready" });
		} catch (error) {
			throw new Error(
				`Attachment incomplete; the target may already be attached. Retry attach with the same controller, target and choices after both sessions settle. ${String(error)}`,
				{ cause: error },
			);
		}
		return {
			attached: true,
			machine: runtime.machine,
			target: panel.pane_id,
			...(route.plan.context
				? {
						contextAgent: route.plan.context.alias,
						controllerContextAgent: route.plan.context.controllerAlias,
					}
				: {}),
			...(route.plan.board
				? {
						boardAgent: route.plan.board.desired.agentName,
						previousBoard: route.plan.board.previous.boardId,
					}
				: {}),
		};
	}
	async detach(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		panel: PaneInfo,
		params: AgentsParams,
		signal: AbortSignal,
	) {
		if (params.board) this.board.requireAvailable();
		const route = attachmentRoutes(ctx).find(
			(entry) =>
				entry.machine === runtime.machine &&
				entry.sessionFile === sessionPath(panel),
		);
		if (!route || route.phase !== "ready")
			throw new Error(
				"No completed attachment for this target in this controller session",
			);
		const { plan } = route;
		if ((params.context && !plan.context) || (params.board && !plan.board))
			throw new Error("Cannot detach a choice that was not attached");
		const controllerBoard = params.board ? binding(ctx) : undefined;
		const check = async (checkRoute = true) => {
			const currentContext =
				params.context && plan.context
					? await this.target.context(ctx, false)
					: undefined;
			signal.throwIfAborted();
			if (
				ctx.sessionManager.getSessionId() !== plan.controllerSessionId ||
				(checkRoute &&
					!isDeepStrictEqual(
						attachmentRoutes(ctx).find(
							(entry) =>
								entry.machine === route.machine &&
								entry.sessionFile === route.sessionFile,
						),
						route,
					)) ||
				(params.context &&
					plan.context &&
					!isDeepStrictEqual(currentContext, plan.context.controller)) ||
				(controllerBoard && !isDeepStrictEqual(binding(ctx), controllerBoard))
			)
				throw new Error(
					"Controller changed during detach; resume it and retry",
				);
		};
		await check();
		try {
			if (params.context && plan.context) {
				await this.notes.verify(
					ctx,
					route.detached?.context ?? plan.context.targetNotes,
					plan.context.target,
					true,
				);
				await check();
			}
			const context = params.context ? await this.notes.export(ctx) : undefined;
			await check();
			this.notes.checkTransport({
				operation: "detach-commit",
				plan,
				context,
				board: params.board,
			});
			const result = await runtime.client.requestContext(
				sessionContextPath(route.sessionFile),
				{
					operation: "detach-commit",
					plan,
					...(context ? { context } : {}),
					...(params.board ? { board: true } : {}),
				},
				signal,
			);
			await check();
			if (
				!result ||
				typeof result !== "object" ||
				!("detached" in result) ||
				result.detached !== true
			)
				throw new Error("Target did not confirm detach");
			let notes: unknown;
			if (params.context && plan.context) {
				if (!("notes" in result))
					throw new Error("Target checkpoints were not retained");
				await this.notes.verify(ctx, result.notes, plan.context.target, true);
				await check();
				notes = result.notes;
			}
			this.pi.appendEntry(ROUTE, {
				...route,
				detached: {
					...route.detached,
					...(notes ? { context: notes } : {}),
					...(params.board ? { board: true } : {}),
				},
			});
			if (params.board && plan.board)
				await this.board.membership.unregisterAttachment(ctx, {
					...plan.board.desired,
					sessionId: plan.targetSessionId,
				});
			await check(false);
		} catch (error) {
			throw new Error(
				`Detach incomplete; retry from the same controller and target with the same choices. ${String(error)}`,
				{ cause: error },
			);
		}
		return {
			detached: true,
			target: panel.pane_id,
			context: !!params.context,
			board: !!params.board,
		};
	}
}
