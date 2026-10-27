import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RemoteHerdrClient } from "../remote/client.js";
import { errorMessage, type MachineRuntime } from "./machine.js";

/** Explicitly requested sharing/monitor readiness; fleet supplies current-selection leases. */
export class FleetSetup {
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
	async prepareContextRelay(
		name: string,
		runtime: MachineRuntime,
		client: RemoteHerdrClient,
		ctx: ExtensionContext,
		isSelected: () => boolean,
	): Promise<void> {
		if (!this.contextRelay) return;
		try {
			await client.startContextRelay(
				ctx.sessionManager.getSessionId(),
				name,
				(request, signal) => this.contextRelay!(ctx, request, signal),
			);
			if (!isSelected()) return;
			delete runtime.contextRelayError;
		} catch (error) {
			if (!isSelected()) return;
			runtime.contextRelayError = errorMessage(error);
			ctx.ui.notify(
				`Context sharing unavailable on ${name}: ${runtime.contextRelayError}\nOpen /herdr → Status to retry sharing.`,
				"warning",
			);
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
				runtime.client instanceof RemoteHerdrClient
			)
				await this.prepareContextRelay(
					name,
					runtime,
					runtime.client,
					ctx,
					isSelected,
				);
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
