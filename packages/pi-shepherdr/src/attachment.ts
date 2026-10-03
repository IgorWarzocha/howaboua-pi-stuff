import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-codex-conversion/context-sharing";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import type { AgentsParams } from "./agents-contract.js";
import { AttachmentNotes } from "./attachment-notes.js";
import {
	type AttachmentPlan,
	type AttachmentRoute,
	DETACHED,
	Detachment,
	Identity,
	inside,
	OWNER,
	Plan,
	ROUTE,
	Route,
	remap,
	remapParams,
	remapResult,
	Snapshot,
	saved,
} from "./attachment-protocol.js";
import type { AgentBoard } from "./board/host.js";
import { binding } from "./board/identity.js";
import { sendPolicyMessage } from "./delivery.js";
import type { ConnectedMachine } from "./fleet.js";
import { sessionPath } from "./herdr.js";
import { attachmentMessage } from "./messages.js";
import {
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";
import type { PaneInfo } from "./types.js";

interface AttachmentMembership {
	role: "controller" | "target";
	machine?: string;
	sessionId: string;
	phase: "pending" | "ready";
	context: "none" | "pending" | "live" | "detached";
	board: "none" | "pending" | "live" | "detached";
	contextAgent?: string;
	boardAgent?: string;
}

/** Mounts live owners without changing their native context or moving board archives. */
export class AgentAttachment {
	private readonly pi: ExtensionAPI;
	private readonly board: AgentBoard;
	private readonly getService: () => ContextSharingService | undefined;
	private readonly notes: AttachmentNotes;
	private readonly onChange: () => void;
	constructor(
		pi: ExtensionAPI,
		board: AgentBoard,
		getService: () => ContextSharingService | undefined,
		onChange: () => void = () => undefined,
	) {
		this.pi = pi;
		this.board = board;
		this.getService = getService;
		this.notes = new AttachmentNotes(getService);
		this.onChange = onChange;
	}
	private summary(
		plan: AttachmentPlan,
		role: "controller" | "target",
		phase: "pending" | "ready",
		detached?: { context?: unknown; board?: boolean },
	): AttachmentMembership {
		return {
			role,
			phase,
			sessionId:
				role === "controller" ? plan.targetSessionId : plan.controllerSessionId,
			context: !plan.context
				? "none"
				: detached?.context
					? "detached"
					: phase === "pending"
						? "pending"
						: "live",
			board: !plan.board
				? "none"
				: detached?.board
					? "detached"
					: phase === "pending"
						? "pending"
						: "live",
			...(plan.context
				? {
						contextAgent:
							role === "controller"
								? plan.context.alias
								: plan.context.controllerAlias,
					}
				: {}),
			...(plan.board ? { boardAgent: plan.board.desired.agentName } : {}),
		};
	}
	memberships(ctx: ExtensionContext): AttachmentMembership[] {
		const owner = this.owner(ctx);
		return [
			...this.routes(ctx).map((route) => ({
				...this.summary(route.plan, "controller", route.phase, route.detached),
				machine: route.machine,
			})),
			...(owner
				? [this.summary(owner, "target", "ready", this.detached(ctx, owner))]
				: []),
		];
	}
	membership(
		ctx: ExtensionContext,
		machine: string,
		panel: PaneInfo,
	): AttachmentMembership | undefined {
		const route = this.routes(ctx).find(
			(entry) =>
				entry.machine === machine && entry.sessionFile === sessionPath(panel),
		);
		return route
			? {
					...this.summary(
						route.plan,
						"controller",
						route.phase,
						route.detached,
					),
					machine,
				}
			: undefined;
	}
	private detached(ctx: ExtensionContext, plan: AttachmentPlan) {
		return saved(ctx, DETACHED, Detachment).findLast((entry) =>
			isDeepStrictEqual(entry.plan, plan),
		);
	}
	private owner(ctx: ExtensionContext) {
		return saved(ctx, OWNER, Plan).findLast(
			(plan) => plan.targetSessionId === ctx.sessionManager.getSessionId(),
		);
	}
	private routes(ctx: ExtensionContext) {
		const found = new Map<string, AttachmentRoute>();
		for (const route of saved(ctx, ROUTE, Route))
			if (route.plan.controllerSessionId === ctx.sessionManager.getSessionId())
				found.set(route.sessionFile + "\0" + route.machine, route);
		return [...found.values()];
	}
	private context(ctx: ExtensionContext, target: boolean) {
		const service = this.getService();
		if (!service?.inspectAttachment || !service.retainAttachmentIdentity)
			throw new Error("Update Codex Conversion to attach existing context");
		const identity = target
			? service.inspectAttachment(ctx)
			: service.describe(ctx);
		if (!identity || !Check(Identity, identity))
			throw new Error(
				"Context attachment requires Local or Tree on both agents; Remote attachment is unsupported",
			);
		return identity as Static<typeof Identity>;
	}
	private retainIdentity(ctx: ExtensionContext) {
		const service = this.getService();
		if (!service?.retainAttachmentIdentity)
			throw new Error(
				"Context attachment support became unavailable; reload and retry",
			);
		service.retainAttachmentIdentity(ctx);
	}
	private inspect(ctx: ExtensionContext) {
		if (!ctx.isIdle()) throw new Error("Attach only after the target settles");
		if (!ctx.sessionManager.getSessionFile())
			throw new Error("Attachment requires a saved target session");
		let context: Static<typeof Identity> | undefined;
		let contextError: string | undefined;
		let boardError: string | undefined;
		try {
			context = this.context(ctx, true);
			if (
				this.routes(ctx).some((route) => route.plan.context) ||
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
			this.board.inspectAttachment(ctx);
		} catch (error) {
			boardError = String(error);
		}
		return {
			sessionId: ctx.sessionManager.getSessionId(),
			board: binding(ctx),
			...(context ? { context, notes: this.notes.export(ctx) } : {}),
			...(contextError ? { contextError } : {}),
			...(boardError ? { boardError } : {}),
		};
	}
	async handle(ctx: ExtensionContext, input: unknown): Promise<unknown> {
		if (!input || typeof input !== "object" || !("operation" in input))
			throw new Error("Invalid attachment request");
		if (input.operation === "attach-inspect") return this.inspect(ctx);
		if (input.operation === "attachment-export-notes") {
			if (
				!("plan" in input) ||
				!Check(Plan, input.plan) ||
				!isDeepStrictEqual(this.owner(ctx), input.plan)
			)
				throw new Error("Invalid checkpoint owner");
			return this.notes.export(ctx);
		}
		if (input.operation === "detach-commit")
			return this.commitDetach(ctx, input);
		if (
			input.operation !== "attach-commit" ||
			!("plan" in input) ||
			!Check(Plan, input.plan)
		)
			throw new Error("Invalid attachment request");
		const plan = input.plan as AttachmentPlan;
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
		const owner = this.owner(ctx);
		if (owner && this.detached(ctx, owner))
			throw new Error("Attachment was detached; reattachment is unsupported");
		if (owner && !isDeepStrictEqual(owner, plan))
			throw new Error(
				"Target is already attached; another controller or different attachment choices are unsupported",
			);
		if (!owner) {
			const current = this.inspect(ctx);
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
			// All checks precede either mutation; no await between the two commits.
			if (plan.context) {
				this.notes.validate(
					plan.context.controllerNotes,
					plan.context.controller,
				);
				this.notes.validate(plan.context.targetNotes, plan.context.target);
			}
			if (plan.context) this.retainIdentity(ctx);
			if (plan.board)
				this.board.commitAttachment(
					ctx,
					plan.board.previous,
					plan.board.desired,
				);
			this.pi.appendEntry(OWNER, plan);
			this.onChange();
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
				!isDeepStrictEqual(this.context(ctx, false), plan.context.target)
			)
				throw new Error("Attached context changed; restore Local or Tree");
			if (
				plan.board &&
				!isDeepStrictEqual(binding(ctx), {
					...plan.board.desired,
					sessionId: plan.targetSessionId,
				})
			)
				throw new Error("Attached board changed; resolve the target again");
		}
		if (plan.board) await this.board.refreshAttachment(ctx);
		if (ctx.sessionManager.getSessionId() !== plan.targetSessionId)
			throw new Error(
				"Target session changed after attachment; resume it and retry",
			);
		return plan;
	}
	async attach(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		panel: PaneInfo,
		params: AgentsParams,
		signal: AbortSignal,
	) {
		const sessionFile = sessionPath(panel);
		const controllerFile = ctx.sessionManager.getSessionFile();
		const controllerSessionId = ctx.sessionManager.getSessionId();
		if (!sessionFile || !controllerFile)
			throw new Error("Attachment requires saved Pi sessions");
		if (runtime.local && sessionFile === controllerFile)
			throw new Error("Cannot attach this session to itself");
		if (this.owner(ctx))
			throw new Error(
				"An attached agent cannot attach another controller; use its existing controller",
			);
		const context = params.context === true;
		const useBoard = params.board === true;
		const controllerContext = context ? this.context(ctx, false) : undefined;
		const controllerBoard = useBoard ? binding(ctx) : undefined;
		const check = () => {
			signal.throwIfAborted();
			if (
				ctx.sessionManager.getSessionId() !== controllerSessionId ||
				(controllerContext &&
					!isDeepStrictEqual(this.context(ctx, false), controllerContext)) ||
				(controllerBoard && !isDeepStrictEqual(binding(ctx), controllerBoard))
			)
				throw new Error(
					"Controller changed during attachment; resume the original session and retry",
				);
		};
		const prior = this.routes(ctx).find(
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
			check();
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
								controllerNotes: this.notes.export(ctx),
								targetNotes: current.notes,
							},
						}
					: {}),
				...(useBoard
					? {
							board: {
								previous: current.board,
								desired: this.board.prepareAttachment(ctx, upstream, segment),
								controller: binding(ctx),
							},
						}
					: {}),
			};
			route = { plan, machine: runtime.machine, sessionFile, phase: "pending" };
			this.notes.checkTransport({ operation: "attach-commit", plan });
			// A retry after a lost response reuses the same aliases and board identity.
			this.pi.appendEntry(ROUTE, route);
			this.onChange();
		}
		try {
			const accepted = await runtime.client.requestContext(
				sessionContextPath(sessionFile),
				{ operation: "attach-commit", plan: route.plan },
				signal,
			);
			check();
			if (!isDeepStrictEqual(accepted, route.plan))
				throw new Error("Target did not accept the requested attachment");
			if (route.plan.board)
				await this.board.registerAttachment(
					ctx,
					runtime,
					sessionFile,
					{
						...route.plan.board.desired,
						sessionId: route.plan.targetSessionId,
					},
					route.plan.board.controller,
				);
			check();
			if (route.plan.context) this.retainIdentity(ctx);
			if (route.phase !== "ready")
				this.pi.appendEntry(ROUTE, { ...route, phase: "ready" });
			this.onChange();
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
	private async commitDetach(ctx: ExtensionContext, input: unknown) {
		if (!Check(Detachment, input)) throw new Error("Invalid detach request");
		const requested = input as Static<typeof Detachment>;
		const { plan } = requested;
		if (
			!isDeepStrictEqual(this.owner(ctx), plan) ||
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
		const previous = this.detached(ctx, plan);
		if (requested.context && plan.context) {
			if (!isDeepStrictEqual(this.context(ctx, false), plan.context.target))
				throw new Error("Target context changed before detach");
			this.notes.validate(requested.context, plan.context.controller);
		}
		const ownNotes = requested.context ? this.notes.export(ctx) : undefined;
		if (ownNotes) this.notes.checkTransport(ownNotes);
		if (requested.board && plan.board && !previous?.board)
			this.board.detachTarget(ctx, plan.board.desired, plan.board.previous);
		this.pi.appendEntry(DETACHED, { ...previous, ...requested });
		this.onChange();
		if (requested.board) await this.board.refreshAttachment(ctx);
		if (ctx.sessionManager.getSessionId() !== plan.targetSessionId)
			throw new Error("Target changed after detach; resume it and retry");
		return { detached: true, ...(ownNotes ? { notes: ownNotes } : {}) };
	}
	async detach(
		ctx: ExtensionContext,
		runtime: ConnectedMachine,
		panel: PaneInfo,
		params: AgentsParams,
		signal: AbortSignal,
	) {
		const route = this.routes(ctx).find(
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
		const check = () => {
			signal.throwIfAborted();
			if (
				ctx.sessionManager.getSessionId() !== plan.controllerSessionId ||
				(params.context &&
					plan.context &&
					!isDeepStrictEqual(this.context(ctx, false), plan.context.controller))
			)
				throw new Error(
					"Controller changed during detach; resume it and retry",
				);
		};
		check();
		try {
			const context = params.context ? this.notes.export(ctx) : undefined;
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
			check();
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
				this.notes.validate(result.notes, plan.context.target);
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
			this.onChange();
			if (params.board && plan.board)
				await this.board.unregisterAttachment(ctx, {
					...plan.board.desired,
					sessionId: plan.targetSessionId,
				});
			check();
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
	async route(
		ctx: ExtensionContext,
		request: SharedContextRequest,
		visited: string[],
		send: (route: AttachmentRoute, request: unknown) => Promise<unknown>,
		signal?: AbortSignal,
	): Promise<SharedContextResult | undefined> {
		const native = this.getService()?.describe(ctx);
		if (
			!native ||
			native.storage !== "session" ||
			request.sessionId !== native.sessionId
		)
			return undefined;
		const child = this.routes(ctx).find(
			(route) =>
				route.phase === "ready" &&
				route.plan.context &&
				inside(request.agentName, route.plan.context.alias),
		);
		if (child?.plan.context) {
			const link = child.plan.context;
			if (!isDeepStrictEqual(native, link.controller))
				throw new Error(
					"Attached controller context changed; restore its original storage",
				);
			const next = {
				...request,
				sessionId: link.target.sessionId,
				agentName: remap(request.agentName, link.alias, link.target.agentName),
				params: remapParams(request.params, link.alias, link.target.agentName),
			};
			let result: SharedContextResult;
			if (!child.detached?.context) {
				try {
					result = (await send(child, {
						operation: "context",
						request: next,
						visited,
					})) as SharedContextResult;
				} catch (error) {
					signal?.throwIfAborted();
					if (!this.notes.unavailable(error)) throw error;
					result = await this.notes.read(
						next,
						link.target,
						link.targetNotes,
						false,
						() =>
							send(child, {
								operation: "attachment-persisted-notes",
								identity: link.target,
							}),
						error,
					);
				}
			} else
				result = await this.notes.read(
					next,
					link.target,
					child.detached.context,
					true,
					async () => undefined,
				);
			return remapResult(result, link.target.agentName, link.alias);
		}
		const owner = this.owner(ctx);
		const link = owner?.context;
		if (owner && link && inside(request.agentName, link.controllerAlias)) {
			if (!isDeepStrictEqual(native, link.target))
				throw new Error(
					"Attached target context changed; restore its original storage",
				);
			const next = {
				...request,
				sessionId: link.controller.sessionId,
				agentName: remap(
					request.agentName,
					link.controllerAlias,
					link.controller.agentName,
				),
				params: remapParams(
					request.params,
					link.controllerAlias,
					link.controller.agentName,
				),
			};
			const detached = this.detached(ctx, owner)?.context;
			let result: SharedContextResult;
			if (!detached) {
				try {
					result = (await requestContext(
						owner.upstream,
						{ operation: "context", request: next, visited },
						signal,
					)) as SharedContextResult;
				} catch (error) {
					signal?.throwIfAborted();
					if (!this.notes.unavailable(error)) throw error;
					result = await this.notes.read(
						next,
						link.controller,
						link.controllerNotes,
						false,
						() =>
							requestContext(
								link.controllerFile
									? sessionContextPath(link.controllerFile)
									: owner.upstream,
								{
									operation: "attachment-persisted-notes",
									identity: link.controller,
								},
								signal,
							),
						error,
					);
				}
			} else
				result = await this.notes.read(
					next,
					link.controller,
					detached,
					true,
					async () => undefined,
				);
			return remapResult(
				result,
				link.controller.agentName,
				link.controllerAlias,
			);
		}
		return undefined;
	}
}
