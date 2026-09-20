import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { waitForTurn } from "../cdp/serial.js";
import { BrowserCdpSession } from "../cdp/session.js";
import { artifactDirectory, pruneArtifacts } from "./artifacts.js";
import { browserHelp } from "./help.js";
import type { BrowserOperation } from "./operation.js";
import { BrowserOperationExecutor } from "./operation-executor.js";
import { executeRemoteBrowser } from "./remote.js";
import type { BrowserRequest } from "./request.js";
import { BrowserRoutes, loadBrowserRoutes } from "./routes.js";

export interface BrowserExecutionOptions {
	ownerId?: string | undefined;
	signal?: AbortSignal | undefined;
	onOperation?(operation: BrowserOperation, index: number, total: number): void;
}

interface LocalSession {
	activeCalls: number;
	cdp: BrowserCdpSession;
	closing?: Promise<void>;
	lastUsed: number;
	operations: BrowserOperationExecutor;
}

const LOCAL_SESSION_IDLE_MS = 20 * 60 * 1_000;

export class BrowserRuntime {
	readonly hosts: readonly string[];
	private readonly defaultOwnerId = randomUUID();
	private readonly lifetime = new AbortController();
	private closing: Promise<void> | undefined;
	private readonly localSessions = new Map<string, LocalSession>();
	private readonly routes: BrowserRoutes;

	constructor(routes = loadBrowserRoutes()) {
		this.routes = routes;
		this.hosts = routes.names;
	}

	async execute(
		request: BrowserRequest,
		options: BrowserExecutionOptions = {},
	): Promise<Record<string, unknown>> {
		options = {
			...options,
			signal: options.signal
				? AbortSignal.any([options.signal, this.lifetime.signal])
				: this.lifetime.signal,
		};
		options.signal?.throwIfAborted();
		await waitForTurn(this.pruneLocalSessions(), options.signal);
		await pruneArtifacts();
		options.signal?.throwIfAborted();
		if ("help" in request) return browserHelp(this.hosts);
		const ownerId = options.ownerId ?? this.defaultOwnerId;
		if (request.host) {
			const route = this.routes.resolve(request.host);
			if (!route.local) {
				const first = request.operations[0];
				if (first) {
					options.onOperation?.(first, 0, request.operations.length);
				}
				const result = await executeRemoteBrowser(
					route,
					request.operations,
					ownerId,
					options.signal,
				);
				return { host: request.host, ...result };
			}
		}
		const result = await this.executeLocal(
			request.operations,
			ownerId,
			options,
		);
		return request.host ? { host: request.host, ...result } : result;
	}

	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.lifetime.abort(new Error("Browser runtime closed"));
		const closing = [...this.localSessions.values()].map((session) =>
			session.cdp.close(),
		);
		this.localSessions.clear();
		this.closing = Promise.all(closing).then(() => undefined);
		return this.closing;
	}

	private async executeLocal(
		operations: BrowserOperation[],
		ownerId: string,
		options: BrowserExecutionOptions,
	): Promise<Record<string, unknown>> {
		let pendingClose = this.localSessions.get(ownerId)?.closing;
		while (pendingClose) {
			await waitForTurn(pendingClose, options.signal);
			pendingClose = this.localSessions.get(ownerId)?.closing;
		}
		options.signal?.throwIfAborted();
		const session = this.localSession(ownerId);
		session.activeCalls++;
		try {
			const results: Record<string, unknown>[] = [];
			for (const [index, operation] of operations.entries()) {
				try {
					options.signal?.throwIfAborted();
					options.onOperation?.(operation, index, operations.length);
					results.push(
						await session.operations.execute(operation, options.signal),
					);
				} catch (error) {
					throw new Error(
						`batch failed at ${operation.action}[${index}] after ${results.length} completed operation(s): ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
			const first = results[0];
			if (results.length === 1 && first) return first;
			return {
				results: results.map((result, index) => ({
					operation: operations[index]?.action ?? "unknown",
					index,
					...result,
				})),
			};
		} finally {
			session.activeCalls--;
			session.lastUsed = Date.now();
		}
	}

	private localSession(ownerId: string): LocalSession {
		let session = this.localSessions.get(ownerId);
		if (session) return session;
		const cdp = new BrowserCdpSession(
			ownerId,
			join(artifactDirectory(), "tabs"),
		);
		session = {
			activeCalls: 0,
			cdp,
			lastUsed: Date.now(),
			operations: new BrowserOperationExecutor(cdp),
		};
		this.localSessions.set(ownerId, session);
		return session;
	}

	private async pruneLocalSessions(now = Date.now()): Promise<void> {
		const closing: Promise<void>[] = [];
		for (const [ownerId, session] of this.localSessions) {
			if (
				!session.closing &&
				session.activeCalls === 0 &&
				now - session.lastUsed >= LOCAL_SESSION_IDLE_MS
			) {
				session.closing = session.cdp.close().finally(() => {
					if (this.localSessions.get(ownerId) === session) {
						this.localSessions.delete(ownerId);
					}
				});
			}
			if (session.closing) closing.push(session.closing);
		}
		await Promise.all(closing);
	}
}
