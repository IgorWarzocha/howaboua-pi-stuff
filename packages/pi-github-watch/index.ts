import { StringEnum } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { deliver, feedbackMessage } from "./src/delivery.js";
import type { ThreadSnapshot } from "./src/feedback.js";
import {
	githubClient,
	type RunSnapshot,
	type WatchTarget,
	type WorkflowRun,
} from "./src/github.js";

interface Watch {
	thread: WatchTarget;
	seen: ThreadSnapshot;
	controller: AbortController;
	timer?: ReturnType<typeof setTimeout>;
	state: "watching" | "paused";
	nextCheck: number;
}
const MINUTE = 60_000;
const HELP =
	"watch: {action: 'watch', thread: issue/PR URL | Actions run URL | owner/repo#123 | issue/PR number}. status: {action: 'status'}. cancel: {action: 'cancel', thread: reference}; omit thread to cancel all offline. Issues/runs check each minute; PRs after 7 minutes, then each minute. PRs surface unresolved review threads, including existing ones; unchanged lists stay quiet. Conversation comments and standalone reviews notify on changes, excluding the authenticated gh user. PR watches stop on closure or merge; closed PRs return immediately. Issue watches continue. Runs follow the latest attempt, notify on completion and stop; completed runs return immediately. Metadata only, no comment bodies/logs. Cancellation/session switch/reload/shutdown ends watches. Failed checks pause; watch again to retry.";

const GPT_HELP =
	"watch:{action:'watch',thread:issue/PR URL|Actions run URL|owner/repo#123|issue/PR number}; status:{action:'status'}; cancel:{action:'cancel',thread:reference}, omit thread=cancel all offline. Poll issues/runs:1min; PRs:first7min then1min. PR unresolved reviewthreads incl existing; unchanged lists=quiet. Conversation comments/standalone reviews: changes notify except authenticated gh user. PR closed/merged=stop; alreadyclosed=return now. Issues continue. Runs: latest attempt; completion=notify+stop; alreadycompleted=return now. Metadata only, no commentbodies/logs. Cancel/session switch/reload/shutdown=end watches. Check failure=pause; retry=watch again.";

function runResult(
	run: WorkflowRun,
	snapshot: Extract<RunSnapshot, { completed: true }>,
): string {
	return `GitHub Actions: ${snapshot.conclusion} (attempt ${snapshot.attempt}) at ${run.url}. Read details with gh run view ${run.number} --repo ${run.repo}.`;
}

export default async function (pi: ExtensionAPI) {
	let promptMode: { readonly active: boolean } | undefined;
	const watches = new Map<string, Watch>();
	let generation = 0;
	const clear = () => {
		generation++;
		for (const watch of watches.values()) {
			clearTimeout(watch.timer);
			watch.controller.abort();
		}
		watches.clear();
	};
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);

	function schedule(watch: Watch, ctx: ExtensionContext, delay: number) {
		watch.nextCheck = Date.now() + delay;
		watch.timer = setTimeout(async () => {
			try {
				const client = githubClient(pi, ctx.cwd, watch.controller.signal);
				if (watch.thread.kind === "run") {
					const snapshot = await client.runSnapshot(watch.thread);
					if (watch.controller.signal.aborted) return;
					if (snapshot.completed) {
						deliver(pi, runResult(watch.thread, snapshot));
						watches.delete(watch.thread.url);
						watch.controller.abort();
						return;
					}
					schedule(watch, ctx, MINUTE);
					return;
				}
				if (watch.thread.kind === "pr") {
					const state = await client.prState(watch.thread);
					if (watch.controller.signal.aborted) return;
					if (state !== "open") {
						deliver(pi, `${watch.thread.url}: PR ${state}. Watch stopped.`);
						watches.delete(watch.thread.url);
						watch.controller.abort();
						return;
					}
				}
				const seen = await client.snapshot(watch.thread);
				if (watch.controller.signal.aborted) return;
				const conversationChanges = [...seen.conversation].filter(
					([id, version]) => watch.seen.conversation.get(id) !== version,
				).length;
				const reviewChanged = [...seen.unresolved].some(
					([id, item]) =>
						watch.seen.unresolved.get(id)?.version !== item.version,
				);
				if (conversationChanges || reviewChanged)
					deliver(pi, feedbackMessage(watch.thread, seen, conversationChanges));
				watch.seen = seen;
				schedule(watch, ctx, MINUTE);
			} catch {
				if (watch.controller.signal.aborted) return;
				watch.state = "paused";
				try {
					deliver(
						pi,
						`GitHub watch paused: ${watch.thread.url}. Checking or notification delivery failed. Check gh auth status and access to the watched URL; call github_watch watch again to resume.`,
					);
				} catch {
					/* UI remains available when turn delivery fails. */
				}
				ctx.ui.notify(
					`GitHub watch paused: ${watch.thread.url}. Check gh auth status and access to the watched URL, then watch again.`,
					"error",
				);
			}
		}, delay);
		watch.timer.unref();
	}
	const tool = defineTool({
		name: "github_watch",
		label: "GitHub watch",
		description:
			"Watch selected GitHub threads for comments or Actions runs for completion in this session",
		parameters: Type.Object(
			{
				action: Type.Optional(
					StringEnum(["help", "watch", "status", "cancel"]),
				),
				thread: Type.Optional(Type.String()),
			},
			{ additionalProperties: false },
		),
		async execute(_id, args, signal, _update, ctx) {
			const result = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: {},
			});
			const action = args.action ?? "help";
			if (action === "help")
				return result(promptMode?.active ? GPT_HELP : HELP);
			if (action === "status")
				return result(
					watches.size
						? [...watches.values()]
								.map(
									(w) =>
										`${w.thread.url} ${w.state}${w.state === "watching" ? `; next check ${new Date(w.nextCheck).toISOString()}` : "; watch again to resume"}`,
								)
								.join("\n")
						: "No active watches.",
				);
			if (action === "cancel" && !args.thread?.trim()) {
				clear();
				return result("All watches cancelled.");
			}
			if (!args.thread?.trim())
				throw new Error(
					"Supply thread: an issue/PR or Actions run URL, owner/repo#123, or an issue/PR number.",
				);
			const epoch = generation;
			const client = githubClient(pi, ctx.cwd, signal);
			const thread = await client.resolve(args.thread);
			if (generation !== epoch)
				throw new Error(
					"Session changed. Start the watch in the current session.",
				);
			const previous = watches.get(thread.url);
			if (action === "cancel") {
				if (previous) {
					clearTimeout(previous.timer);
					previous.controller.abort();
					watches.delete(thread.url);
				}
				return result(
					`${thread.url}: ${previous ? "cancelled" : "not watched"}`,
				);
			}
			if (previous?.state === "watching")
				return result(`${thread.url}: already watching`);
			let seen: ThreadSnapshot = {
				conversation: new Map(),
				unresolved: new Map(),
			};
			const runSnapshot =
				thread.kind === "run" ? await client.runSnapshot(thread) : undefined;
			const prState =
				thread.kind === "pr" ? await client.prState(thread) : undefined;
			if (thread.kind !== "run" && (!prState || prState === "open"))
				seen = await client.snapshot(thread);
			if (generation !== epoch || signal?.aborted)
				throw new Error(
					"Watch setup interrupted. Retry in the current session.",
				);
			if (watches.get(thread.url)?.state === "watching")
				return result(`${thread.url}: already watching`);
			previous?.controller.abort();
			if (prState && prState !== "open") {
				watches.delete(thread.url);
				return result(`${thread.url}: PR ${prState}. No watch started.`);
			}
			if (thread.kind === "run" && runSnapshot?.completed) {
				watches.delete(thread.url);
				return result(`${runResult(thread, runSnapshot)} No watch started.`);
			}
			const watch: Watch = {
				thread,
				// Baseline conversation history, but surface existing unresolved threads on the first check.
				seen: previous?.seen ?? {
					conversation: seen.conversation,
					unresolved: new Map(),
				},
				controller: new AbortController(),
				state: "watching",
				nextCheck: 0,
			};
			watches.set(thread.url, watch);
			schedule(watch, ctx, thread.kind === "pr" ? 7 * MINUTE : MINUTE);
			return result(
				`${thread.url}: watching; first check ${new Date(watch.nextCheck).toISOString()}`,
			);
		},
	});
	pi.registerTool(tool);
	try {
		const module = "@howaboua/pi-codex-conversion/prompt-mode";
		const { registerGptPromptMode } = await import(module);
		promptMode = registerGptPromptMode(pi, () => [tool]);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				discovery: "help",
				deferLoading: true,
			}),
		]);
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			!["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(
				String(error.code),
			) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
}
