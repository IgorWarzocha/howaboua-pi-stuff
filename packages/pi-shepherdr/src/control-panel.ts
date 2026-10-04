import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PanelActions, type PanelOptions } from "./control-panel-actions.js";
import type { PanelTab as Tab } from "./control-panel-items.js";
import { PanelView } from "./control-panel-view.js";
import { addSshConnection, type SshSetupDraft } from "./ssh-setup.js";

export function controlPanelStatus(
	ctx: ExtensionContext,
	options: PanelOptions,
): string {
	return [
		`Orchestration ${options.orchestration() ? "on" : "off"}.`,
		options.board.status(ctx),
		...options.fleet
			.statuses()
			.map(
				(machine) =>
					`${machine.label ?? machine.id} [${machine.id}]: ${machine.status}${machine.reason ? `\n${machine.reason}` : ""}${machine.monitoringIssue ? `\nMonitoring: ${machine.monitoringIssue.message}` : ""}${machine.contextRelayError ? `\nSharing: ${machine.contextRelayError}` : ""}`,
			),
		...(!options.fleet.isActive()
			? [
					"Fleet inactive. Run Pi inside Herdr; open /herdr → Status to reconnect.",
				]
			: []),
		"Open /herdr in TUI for Settings, Status and SSH Connections.",
	].join("\n");
}

export async function openControlPanel(
	ctx: ExtensionContext,
	options: PanelOptions,
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const lifetime = new AbortController();
	const signal = AbortSignal.any([options.signal, lifetime.signal]);
	const state: { tab: Tab; message: string; draft: SshSetupDraft } = {
		tab: "Settings",
		message: "",
		draft: { target: "", label: "", session: "" },
	};
	const check = () => {
		signal.throwIfAborted();
		if (ctx.sessionManager.getSessionId() !== sessionId)
			throw new Error("Session changed; reopen /herdr");
	};
	try {
		while (true) {
			check();
			const action = await showControlPanel(
				ctx,
				options,
				signal,
				sessionId,
				state,
			);
			if (action !== "add") return;
			try {
				check();
				const result = await addSshConnection(ctx, state.draft, signal);
				check();
				state.message = result.message;
				if (result.refresh) {
					try {
						await options.reconnect(undefined, signal);
					} catch (error) {
						state.message += ` Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
					}
				}
			} catch (error) {
				check();
				state.message = error instanceof Error ? error.message : String(error);
			}
		}
	} finally {
		lifetime.abort();
	}
}

async function showControlPanel(
	ctx: ExtensionContext,
	options: PanelOptions,
	signal: AbortSignal,
	sessionId: string,
	state: { tab: Tab; message: string; draft: SshSetupDraft },
): Promise<"add" | undefined> {
	return ctx.ui.custom<"add" | undefined>((tui, theme, _kb, done) => {
		let disposed = false;
		const current = () =>
			!disposed &&
			!signal.aborted &&
			ctx.sessionManager.getSessionId() === sessionId;
		const check = () => {
			signal.throwIfAborted();
			if (!current()) throw new Error("Session changed; reopen /herdr");
		};
		const actions = new PanelActions(
			ctx,
			options,
			signal,
			state.message,
			current,
			check,
			() => view.rebuild(),
			() => tui.requestRender(),
			finish,
		);
		const view = new PanelView(
			ctx,
			options,
			tui,
			theme,
			state.tab,
			state.draft,
			actions,
			current,
			close,
		);
		function close() {
			finish(undefined);
		}
		function finish(result: "add" | undefined) {
			if (disposed) return;
			state.tab = view.tab;
			state.message = actions.message;
			cleanup();
			done(result);
		}
		const subscriptions = [
			options.fleet.subscribe(() => view.rebuild()),
			options.board.subscribe(() => view.rebuild()),
		];
		function cleanup() {
			disposed = true;
			signal.removeEventListener("abort", close);
			for (const unsubscribe of subscriptions) unsubscribe();
		}
		signal.addEventListener("abort", close, { once: true });
		view.rebuild();
		if (signal.aborted) close();
		return Object.assign(view, { dispose: cleanup });
	});
}
