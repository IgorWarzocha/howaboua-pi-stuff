import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { runSetupProcess } from "./setup-process.js";

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
			label: "Machine name",
			currentValue: draft.label || "required",
			values: ["Enter"],
		},
		{
			id: "ssh:session",
			label: "Remote session",
			currentValue: draft.session || "Core default",
			values: ["Enter"],
			description: "Optional Core session name. Leave empty for the default.",
		},
		{
			id: "ssh:add",
			label: "Add connection",
			currentValue: "Enter",
			values: ["Enter"],
			description:
				"Opens hc machine add in the terminal. Ctrl+C cancels. Installation approvals stay interactive.",
		},
	];
}

export function sshSetupArgs(draft: SshSetupDraft): string[] {
	const { target, label, session } = draft;
	if (!target || /^[-\s]|[\s\x00-\x1f\x7f]/.test(target))
		throw new Error(
			"Enter an SSH alias or user@host, without spaces or options.",
		);
	if (!/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(label))
		throw new Error(
			"Machine name must use 1–32 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit.",
		);
	if (session && !/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(session))
		throw new Error(
			"Session must use 1–32 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit.",
		);
	return [
		"machine",
		"add",
		target,
		"--name",
		label,
		...(session ? ["--session", session] : []),
	];
}

export async function addSshConnection(
	ctx: ExtensionContext,
	draft: SshSetupDraft,
	signal: AbortSignal,
): Promise<{ message: string; refresh: boolean }> {
	const args = sshSetupArgs(draft);
	const result = await ctx.ui.custom<{
		code: number | null;
		signal: NodeJS.Signals | null;
		interrupted: boolean;
	}>(async (tui, _theme, _kb, done) => {
		signal.throwIfAborted();
		tui.stop();
		// The terminal sends Ctrl+C to both processes. Let hc handle it,
		// without allowing Node's default handler to terminate Pi.
		let interrupted = false;
		const interrupt = () => {
			interrupted = true;
		};
		let result: { code: number | null; signal: NodeJS.Signals | null };
		try {
			process.stdout.write("\x1b[2J\x1b[H");
			process.on("SIGINT", interrupt);
			result = await runSetupProcess("hc", args, signal);
		} finally {
			process.removeListener("SIGINT", interrupt);
			tui.start();
			tui.requestRender(true);
		}
		done({ ...result, interrupted });
		return { render: () => [], invalidate: () => {} };
	});
	signal.throwIfAborted();
	if (result.interrupted || result.code !== 0)
		return {
			message: `Core setup ${result.interrupted || result.signal ? `cancelled (${result.signal ?? "SIGINT"})` : `exited with code ${result.code ?? "unknown"}`}. Check Status before retrying.`,
			refresh: true,
		};
	return {
		message: "Core setup completed. Check Status for the connection.",
		refresh: true,
	};
}
