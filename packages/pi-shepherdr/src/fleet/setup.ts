import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "../core/backend.js";
import { RemoteHerdrClient } from "../remote/client.js";
import { errorMessage, type MachineRuntime } from "./machine.js";

/** Explicitly requested sharing/monitor readiness; fleet supplies current-selection leases. */
export class FleetSetup {
	// Concurrent publishers share one start; existing children retain its route.
	private readonly relays = new WeakMap<
		RemoteHerdrClient | CoreConnection,
		Promise<void>
	>();
	private readonly refresh: () => void;
	constructor(refresh: () => void) {
		this.refresh = refresh;
	}
	private contextRelay:
		| ((
				ctx: ExtensionContext,
				request: unknown,
				signal: AbortSignal,
		  ) => Promise<unknown>)
		| undefined;
	setContextRelay(
		handler: (
			ctx: ExtensionContext,
			request: unknown,
			signal: AbortSignal,
		) => Promise<unknown>,
	): void {
		this.contextRelay = handler;
	}
	prepareContextRelay(
		name: string,
		runtime: MachineRuntime,
		client: RemoteHerdrClient | CoreConnection,
		ctx: ExtensionContext,
		isSelected: () => boolean,
	): Promise<void> {
		if (!this.contextRelay)
			return Promise.reject(
				new Error("Context sharing is unavailable in this session"),
			);
		const ready = this.relays.get(client);
		if (ready) return ready;
		const starting = this.openContextRelay(
			name,
			runtime,
			client,
			ctx,
			isSelected,
		);
		this.relays.set(client, starting);
		return starting;
	}
	private async openContextRelay(
		name: string,
		runtime: MachineRuntime,
		client: RemoteHerdrClient | CoreConnection,
		ctx: ExtensionContext,
		isSelected: () => boolean,
	): Promise<void> {
		if (!this.contextRelay)
			throw new Error("Context sharing is unavailable in this session");
		const failed = (error: unknown) => {
			this.relays.delete(client);
			if (!isSelected()) return;
			runtime.contextRelayError = errorMessage(error);
			ctx.ui.notify(
				`Context sharing unavailable on ${name}: ${runtime.contextRelayError}\nOpen /herdr → Status to retry sharing.`,
				"warning",
			);
			this.refresh();
		};
		try {
			const args = [
				ctx.sessionManager.getSessionId(),
				name,
				(request: unknown, signal: AbortSignal) =>
					this.contextRelay!(ctx, request, signal),
			] as const;
			if (client instanceof CoreConnection)
				await client.startContextRelay(...args, failed);
			else await client.startContextRelay(...args);
			if (!isSelected()) return;
			delete runtime.contextRelayError;
		} catch (error) {
			failed(error);
			throw error;
		}
	}

	async retrySetup(
		name: string,
		runtime: MachineRuntime,
		ctx: ExtensionContext | undefined,
		isCurrent: () => boolean,
		isRegistered: () => boolean,
		isSelected: () => boolean,
	): Promise<void> {
		const monitor = runtime.monitor;
		if (!monitor || !ctx || runtime.attempting) return;
		runtime.attempting = true;
		this.refresh();
		try {
			if (
				runtime.contextRelayError &&
				(runtime.client instanceof RemoteHerdrClient ||
					runtime.client instanceof CoreConnection)
			)
				await this.prepareContextRelay(
					name,
					runtime,
					runtime.client,
					ctx,
					isSelected,
				).catch(() => {});
			if (isCurrent() && isRegistered() && runtime.monitoringIssue)
				await monitor.retryMonitoring();
		} catch (error) {
			if (isCurrent() && isRegistered() && runtime.monitor === monitor) {
				ctx.ui.notify(
					`Monitoring retry failed on ${name}: ${errorMessage(error)}`,
					"warning",
				);
			}
		} finally {
			if (isRegistered() && runtime.monitor === monitor)
				delete runtime.attempting;
			this.refresh();
		}
	}
}
