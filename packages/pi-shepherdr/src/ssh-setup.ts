import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { readMachineCatalog, withHerdrBinary } from "./machine-catalog.js";
import { runSetupProcess } from "./setup-process.js";

// Herdr's default session is named "default". Pin it explicitly so native
// interactive session discovery cannot change the identity of a blank draft.
const DEFAULT_REMOTE_SESSION = "default";

export interface SshSetupDraft {
	target: string;
	label: string;
	session: string;
}

export function sshSetupItems(draft: SshSetupDraft): SettingItem[] {
	return [
		{
			id: "ssh:target",
			label: "SSH target",
			currentValue: draft.target || "required",
			values: ["Enter"],
			description:
				"OpenSSH alias or user@host. Uses your SSH keys and configuration.",
		},
		{
			id: "ssh:label",
			label: "Label",
			currentValue: draft.label || "required",
			values: ["Enter"],
		},
		{
			id: "ssh:session",
			label: "Remote session",
			currentValue: draft.session || "Herdr default",
			values: ["Enter"],
			description: "Optional Herdr session name. Leave empty for the default.",
		},
		{
			id: "ssh:add",
			label: "Add connection",
			currentValue: "Enter",
			values: ["Enter"],
			description:
				"Opens Herdr setup in the terminal. Ctrl+C cancels. Installation approvals stay interactive.",
		},
	];
}

export function sshSetupArgs(draft: SshSetupDraft): string[] {
	const { target, label, session } = draft;
	if (!target || /^[-\s]|[\s\x00-\x1f\x7f]/.test(target))
		throw new Error(
			"Enter an SSH alias or user@host, without spaces or options.",
		);
	if (!label || /[\x00-\x1f\x7f]/.test(label))
		throw new Error("Enter a label without control characters.");
	if (
		session &&
		(!/^[a-zA-Z0-9_.-]{1,64}$/.test(session) ||
			session === "." ||
			session === "..")
	)
		throw new Error(
			"Session must use 1–64 letters, digits, dots, underscores or hyphens.",
		);
	return [
		"machine",
		"add",
		target,
		"--label",
		label,
		"--remote-session",
		session || DEFAULT_REMOTE_SESSION,
	];
}

export async function addSshConnection(
	ctx: ExtensionContext,
	draft: SshSetupDraft,
	signal: AbortSignal,
): Promise<{ message: string; refresh: boolean }> {
	const args = sshSetupArgs(draft);
	const session = draft.session || DEFAULT_REMOTE_SESSION;
	const matchesDraft = (machine: { target: string; session: string }) =>
		machine.target === draft.target && machine.session === session;
	// Inspect on every attempt, including retries after interrupted setup.
	const catalog = await readMachineCatalog(signal);
	signal.throwIfAborted();
	const existing = Object.values(catalog).find(matchesDraft);
	if (existing)
		return {
			message: `Already configured as ${existing.label}. Check Status.`,
			refresh: true,
		};
	const result = await withHerdrBinary((binary) =>
		ctx.ui.custom<{
			code: number | null;
			signal: NodeJS.Signals | null;
			interrupted: boolean;
		}>(async (tui, _theme, _kb, done) => {
			signal.throwIfAborted();
			tui.stop();
			// The terminal sends Ctrl+C to both processes. Let Herdr handle it,
			// without allowing Node's default handler to terminate Pi.
			let interrupted = false;
			const interrupt = () => {
				interrupted = true;
			};
			let result: { code: number | null; signal: NodeJS.Signals | null };
			try {
				process.stdout.write("\x1b[2J\x1b[H");
				process.on("SIGINT", interrupt);
				result = await runSetupProcess(binary, args, signal);
			} finally {
				process.removeListener("SIGINT", interrupt);
				tui.start();
				tui.requestRender(true);
			}
			done({ ...result, interrupted });
			return { render: () => [], invalidate: () => {} };
		}),
	);
	signal.throwIfAborted();
	if (result.interrupted || result.code !== 0)
		return {
			message: `Herdr setup ${result.interrupted || result.signal ? `cancelled (${result.signal ?? "SIGINT"})` : `exited with code ${result.code ?? "unknown"}`}. Profile not confirmed. Retry checks the catalog first.`,
			refresh: false,
		};
	const saved = Object.values(await readMachineCatalog(signal)).some(
		matchesDraft,
	);
	signal.throwIfAborted();
	if (!saved)
		return {
			message:
				"No matching profile saved. Setup may have been cancelled; retry checks the catalog first.",
			refresh: false,
		};
	return {
		message: "Herdr setup completed. Check Status for the connection.",
		refresh: true,
	};
}
