import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	ContextSharingService,
	SharedContextRequest,
	SharedContextResult,
} from "@howaboua/pi-codex-conversion/context-sharing";
import type { AttachmentNotes } from "./attachment-notes.js";
import {
	type AttachmentRoute,
	attachmentOwner,
	attachmentRoutes,
	detachment,
	inside,
	remap,
	remapParams,
	remapResult,
} from "./attachment-protocol.js";
import {
	requestContext,
	sessionContextPath,
} from "./remote/shepherdr-context.mjs";

/** Routes counterpart aliases and preserves read-only checkpoint recovery policy. */
export class AttachmentRouting {
	private readonly getService: () => ContextSharingService | undefined;
	private readonly notes: AttachmentNotes;
	constructor(
		getService: () => ContextSharingService | undefined,
		notes: AttachmentNotes,
	) {
		this.getService = getService;
		this.notes = notes;
	}
	async route(
		ctx: ExtensionContext,
		request: SharedContextRequest,
		visited: string[],
		send: (route: AttachmentRoute, request: unknown) => Promise<unknown>,
		signal?: AbortSignal,
	): Promise<SharedContextResult | undefined> {
		const native = this.getService()?.describe(ctx);
		if (!native || request.sessionId !== native.sessionId) return undefined;
		const child = attachmentRoutes(ctx).find(
			(route) =>
				route.phase === "ready" &&
				route.plan.context &&
				inside(request.agentName, route.plan.context.alias),
		);
		if (child?.plan.context) {
			const link = child.plan.context;
			if (!isDeepStrictEqual(native, link.controller))
				throw new Error(
					"Shared notes are unavailable. Use messages to exchange the context you need.",
				);
			const next = {
				...request,
				sessionId: link.target.sessionId,
				agentName: remap(request.agentName, link.alias, link.target.agentName),
				params: remapParams(request.params, link.alias, link.target.agentName),
			};
			let result: SharedContextResult;
			if (link.target.storage === "remote") {
				if (child.detached?.context && !this.notes.canRead(next))
					throw new Error(
						"Detached counterpart checkpoints are read-only; native history is unchanged",
					);
				result = await this.notes.remote(
					ctx,
					child.detached?.context ?? link.targetNotes,
					next,
					signal,
				);
			} else if (!child.detached?.context) {
				try {
					result = (await send(child, {
						operation: "context",
						request: next,
						visited,
					})) as SharedContextResult;
				} catch (error) {
					signal?.throwIfAborted();
					if (!this.notes.canRead(next) || !this.notes.unavailable(error))
						throw error;
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
		const owner = attachmentOwner(ctx);
		const link = owner?.context;
		if (owner && link && inside(request.agentName, link.controllerAlias)) {
			if (!isDeepStrictEqual(native, link.target))
				throw new Error(
					"Shared notes are unavailable. Use messages to exchange the context you need.",
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
			const detached = detachment(ctx, owner)?.context;
			let result: SharedContextResult;
			if (link.controller.storage === "remote") {
				if (detached && !this.notes.canRead(next))
					throw new Error(
						"Detached counterpart checkpoints are read-only; native history is unchanged",
					);
				result = await this.notes.remote(
					ctx,
					detached ?? link.controllerNotes,
					next,
					signal,
				);
			} else if (!detached) {
				try {
					result = (await requestContext(
						owner.upstream,
						{ operation: "context", request: next, visited },
						signal,
					)) as SharedContextResult;
				} catch (error) {
					signal?.throwIfAborted();
					if (!this.notes.canRead(next) || !this.notes.unavailable(error))
						throw error;
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
