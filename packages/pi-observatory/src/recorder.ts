import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { stateDirectory } from "./config.ts";
import {
	type ObservationOrigin,
	recordToolObservations,
} from "./tool-recorder.ts";

type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;
type Command = Pick<SlashCommandInfo, "name" | "source" | "sourceInfo">;

interface ObservationFile {
	path: string;
	inventory: string;
	covered: boolean;
}

// Pi's public inventory scopes recording to extensions, skills and templates.
// Builtin controls and unlisted slash text are outside the usage audit.
export function recordObservations(pi: ExtensionAPI): void {
	const files = new Map<string, ObservationFile>();
	let detach: (() => void) | undefined;
	let factory: EditorFactory | undefined;
	let currentContext: ExtensionContext;
	let attached = false;
	let reportedWriteError = false;

	function notifyFailure(ctx: ExtensionContext): void {
		if (reportedWriteError) return;
		reportedWriteError = true;
		ctx.ui.notify(
			"Observatory could not save an observation. Your session will continue. Check free space and Observatory storage permissions.",
			"warning",
		);
	}

	function append(
		ctx: ExtensionContext,
		customType: string,
		data: object,
		origin?: ObservationOrigin,
	): boolean {
		try {
			const sessionId = origin?.sessionId ?? ctx.sessionManager.getSessionId();
			const timestamp = new Date().toISOString();
			const record = `${JSON.stringify({
				id: randomUUID(),
				timestamp,
				type: "custom",
				customType,
				data,
			})}\n`;
			// Bound each synchronous write; never let telemetry write unbounded data.
			if (Buffer.byteLength(record) > 1024 * 1024)
				throw new Error("Observation exceeds the write limit");
			let file = files.get(sessionId);
			if (!file) {
				const directory = join(stateDirectory(), "events");
				mkdirSync(directory, { recursive: true, mode: 0o700 });
				file = {
					path: join(directory, `${randomUUID()}.jsonl`),
					inventory: "",
					covered: false,
				};
				appendFileSync(
					file.path,
					`${JSON.stringify({
						type: "session",
						version: 3,
						id: sessionId,
						cwd: origin?.cwd ?? ctx.sessionManager.getCwd(),
						timestamp,
					})}\n`,
					{ flag: "wx", mode: 0o600 },
				);
				files.set(sessionId, file);
			}
			appendFileSync(file.path, record, { mode: 0o600 });
			reportedWriteError = false;
			return true;
		} catch {
			notifyFailure(ctx);
			return false;
		}
	}

	function coverage(ctx: ExtensionContext): void {
		if (
			attached &&
			!files.get(ctx.sessionManager.getSessionId())?.covered &&
			append(ctx, "pi-observatory:recorder", {
				version: 1,
				inputSource: "interactive",
			})
		) {
			const file = files.get(ctx.sessionManager.getSessionId());
			if (file) file.covered = true;
		}
	}

	function inventory(ctx: ExtensionContext): Command[] {
		const commands = pi
			.getCommands()
			.filter(({ sourceInfo }) => sourceInfo.source !== "builtin")
			.map(({ name, source, sourceInfo }) => ({ name, source, sourceInfo }));
		const signature = JSON.stringify(commands);
		const file = files.get(ctx.sessionManager.getSessionId());
		if (
			signature !== file?.inventory &&
			append(ctx, "pi-observatory:inventory", { version: 1, commands })
		) {
			const written = files.get(ctx.sessionManager.getSessionId());
			if (written) written.inventory = signature;
		}
		return commands;
	}

	function capture(ctx: ExtensionContext, text: string): void {
		const name = /^\/([^\s]+)(?=\s|$)/u.exec(text.trim())?.[1];
		if (!name) return;
		coverage(ctx);
		const command = inventory(ctx).find((item) => item.name === name);
		if (!command) return;
		append(ctx, "pi-observatory:command_submission", {
			version: 1,
			name,
			source: command.source,
			inputSource: "interactive",
			sourceInfo: command.sourceInfo,
		});
	}

	function attach(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		currentContext = ctx;
		if (factory && ctx.ui.getEditorComponent() === factory) {
			try {
				coverage(ctx);
				inventory(ctx);
			} catch {
				notifyFailure(ctx);
			}
			return;
		}
		detach?.();
		const previous = ctx.ui.getEditorComponent();
		let active = true;
		const restores: (() => void)[] = [];
		const observed: EditorFactory = (tui, theme, keybindings) => {
			const editor =
				previous?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings, { embedWorkingStatus: true });
			// Pi wires onSubmit after the factory returns. Observe that public callback,
			// not raw Enter, which may only accept an autocomplete/menu selection.
			queueMicrotask(() => {
				// A later factory may legitimately compose this one.
				if (!active) return;
				const submit = editor.onSubmit;
				if (!submit) return;
				const onSubmit: typeof submit = function (text) {
					// Save origin before /new, /resume, /reload or /quit can change it.
					try {
						capture(currentContext, text);
					} catch {
						notifyFailure(currentContext);
					} finally {
						return submit.call(editor, text);
					}
				};
				editor.onSubmit = onSubmit;
				restores.push(() => {
					if (editor.onSubmit === onSubmit) editor.onSubmit = submit;
				});
				attached = true;
				coverage(currentContext);
				try {
					inventory(currentContext);
				} catch {
					notifyFailure(ctx);
				}
			});
			return editor;
		};
		factory = observed;
		detach = () => {
			active = false;
			attached = false;
			for (const restore of restores) restore();
			if (ctx.ui.getEditorComponent() === observed)
				ctx.ui.setEditorComponent(previous);
			factory = undefined;
			detach = undefined;
		};
		ctx.ui.setEditorComponent(observed);
	}

	recordToolObservations(pi, append, notifyFailure);
	pi.on("session_start", (_event, ctx) => attach(ctx));
	pi.on("before_agent_start", (_event, ctx) => attach(ctx));
	pi.on("session_shutdown", () => detach?.());
}
