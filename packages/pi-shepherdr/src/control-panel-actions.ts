import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PanelOwners } from "./control-panel-items.js";
import { type SshSetupDraft, sshSetupArgs } from "./ssh-setup.js";

export interface PanelOptions extends PanelOwners {
	setOrchestration: (enabled: boolean, signal: AbortSignal) => Promise<void>;
	reconnect: (
		machine: string | undefined,
		signal: AbortSignal,
	) => Promise<string>;
	signal: AbortSignal;
}

/** Executes panel actions without owning native input or terminal handoff. */
export class PanelActions {
	busy = false;
	message: string;

	private readonly ctx: ExtensionContext;
	private readonly options: PanelOptions;
	private readonly signal: AbortSignal;
	private readonly current: () => boolean;
	private readonly check: () => void;
	private readonly rebuild: () => void;
	private readonly requestRender: () => void;
	private readonly finish: (result: "add" | undefined) => void;

	constructor(
		ctx: ExtensionContext,
		options: PanelOptions,
		signal: AbortSignal,
		message: string,
		current: () => boolean,
		check: () => void,
		rebuild: () => void,
		requestRender: () => void,
		finish: (result: "add" | undefined) => void,
	) {
		this.ctx = ctx;
		this.options = options;
		this.signal = signal;
		this.current = current;
		this.check = check;
		this.rebuild = rebuild;
		this.requestRender = requestRender;
		this.finish = finish;
		this.message = message;
	}

	change(id: string, value: string, draft: SshSetupDraft) {
		if (id === "ssh:add") {
			try {
				sshSetupArgs(draft);
				this.finish("add");
			} catch (error) {
				this.message = error instanceof Error ? error.message : String(error);
				this.rebuild();
			}
			return;
		}
		this.run(async () => {
			if (id === "orchestration") {
				await this.options.setOrchestration(value === "on", this.signal);
				this.message = "Guidance saved for this session.";
			} else if (
				id === "board:session" ||
				id === "board:folder" ||
				id === "board:global"
			) {
				await this.options.board.setSetting(
					this.ctx,
					id === "board:session"
						? "session"
						: id === "board:folder"
							? "folder"
							: "global",
					value === "inherit" ? undefined : value === "on",
				);
				this.check();
				this.message = "Board setting saved.";
			} else if (id === "connect" || id.startsWith("machine:"))
				this.message = await this.options.reconnect(
					id === "connect" ? undefined : id.slice(8),
					this.signal,
				);
		});
	}

	private run(work: () => Promise<void>) {
		if (this.busy || !this.current()) {
			this.rebuild();
			return;
		}
		this.busy = true;
		this.message = "Working...";
		this.requestRender();
		void (async () => {
			try {
				this.check();
				await work();
			} catch (error) {
				if (this.current())
					this.message = error instanceof Error ? error.message : String(error);
			} finally {
				this.busy = false;
				this.rebuild();
			}
		})();
	}
}
