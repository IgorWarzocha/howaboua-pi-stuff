import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { compile, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { deliver, feedbackMessage } from "./src/delivery.js";
import type { ThreadSnapshot } from "./src/feedback.js";
import {
	githubClient,
	type RunSnapshot,
	type WatchTarget,
	type WorkflowRun,
} from "./src/github.js";

const WatchParameters = obj({
	action: opt({
		...oneOf(["help", "watch", "status", "cancel"]),
		type: "string",
	}),
	thread: opt(str()),
});
const checkParameters = compile(WatchParameters).check;
interface Watch {
	thread: WatchTarget;
	seen: ThreadSnapshot;
	headSha: string | undefined;
	controller: AbortController;
	timer?: ReturnType<typeof setTimeout>;
	state: "watching" | "paused";
	nextCheck: number;
}
const MINUTE = 60000;
const AUTOMATIC_UPDATES =
	"Updates arrive automatically; no polling or gh run watch needed";
const HELP =
	"action: watch, status, cancel. watch thread: issue/PR or Actions run URL, owner/repo#123, number for current repo's GitHub origin. status→list; cancel same thread or omit→cancel all offline. Checks every minute; PR first after 7min. Conversation/standalone review changes except authenticated gh account's; PR head changes and existing/updated unresolved threads. PR closed/merged or latest run attempt complete→report+stop; already terminal→report immediately. Fetch bodies/logs separately. Session switch/reload/shutdown→end watches. Check failure→pause; watch again→resume";

function runResult(
	run: WorkflowRun,
	snapshot: Extract<
		RunSnapshot,
		{
			completed: true;
		}
	>,
): string {
	return `GitHub Actions: ${snapshot.conclusion} (attempt ${snapshot.attempt}) at ${run.url}. Read details with gh run view ${run.number} --repo ${run.repo}.`;
}

export default async function (pi: ExtensionAPI) {
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
		// oxlint-disable-next-line typescript/no-misused-promises -- Polling catches failures, pauses the watch and reports recovery instructions.
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
				const pr =
					watch.thread.kind === "pr"
						? await client.prSnapshot(watch.thread)
						: undefined;
				if (pr) {
					if (watch.controller.signal.aborted) return;
					if (pr.state !== "open") {
						deliver(pi, `${watch.thread.url}: PR ${pr.state}. Watch stopped.`);
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
				if (
					[...seen.userNotices].some(
						([id, version]) => watch.seen.userNotices.get(id) !== version,
					)
				)
					ctx.ui.notify(
						`Automated review reached a usage limit: ${watch.thread.url}`,
						"warning",
					);
				const reviewChanged = [...seen.unresolved].some(
					([id, item]) =>
						watch.seen.unresolved.get(id)?.version !== item.version,
				);
				const headChange =
					pr && watch.headSha && pr.headSha !== watch.headSha
						? { before: watch.headSha, after: pr.headSha }
						: undefined;
				if (conversationChanges || reviewChanged || headChange)
					deliver(
						pi,
						feedbackMessage(
							watch.thread,
							seen,
							conversationChanges,
							headChange,
						),
					);
				watch.seen = seen;
				watch.headSha = pr?.headSha;
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
			"Watch GitHub feedback, PR commits or Actions completion in this session",
		parameters: WatchParameters,
		async execute(_id, args, signal, _update, ctx) {
			if (!checkParameters(args))
				throw new Error(
					"Invalid arguments; call github_watch with no arguments for help",
				);
			const result = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: {},
			});
			const action = args.action ?? "help";
			if (action === "help") return result(HELP);
			if (action === "status") {
				if (!watches.size) return result("No active watches.");
				const current = [...watches.values()];
				const lines = current.map(
					(w) =>
						`${w.thread.url} ${w.state}${w.state === "watching" ? `; next check ${new Date(w.nextCheck).toISOString().slice(0, 16)}Z` : "; watch again to resume"}`,
				);
				if (current.some((w) => w.state === "watching"))
					lines.push(AUTOMATIC_UPDATES);
				return result(lines.join("\n"));
			}
			if (action === "cancel" && !args.thread?.trim()) {
				clear();
				return result("OK");
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
				return result(`${thread.url}: already watching. ${AUTOMATIC_UPDATES}`);
			let seen: ThreadSnapshot = {
				conversation: new Map(),
				userNotices: new Map(),
				unresolved: new Map(),
			};
			const runSnapshot =
				thread.kind === "run" ? await client.runSnapshot(thread) : undefined;
			const pr =
				thread.kind === "pr" ? await client.prSnapshot(thread) : undefined;
			if (thread.kind !== "run" && (!pr || pr.state === "open"))
				seen = await client.snapshot(thread);
			if (generation !== epoch || signal?.aborted)
				throw new Error(
					"Watch setup interrupted. Retry in the current session.",
				);
			if (watches.get(thread.url)?.state === "watching")
				return result(`${thread.url}: already watching. ${AUTOMATIC_UPDATES}`);
			previous?.controller.abort();
			if (pr && pr.state !== "open") {
				watches.delete(thread.url);
				return result(`${thread.url}: PR ${pr.state}. No watch started.`);
			}
			if (thread.kind === "run" && runSnapshot?.completed) {
				watches.delete(thread.url);
				return result(`${runResult(thread, runSnapshot)} No watch started.`);
			}
			const watch: Watch = {
				thread,
				headSha: previous?.headSha ?? pr?.headSha,
				// Baseline conversation history, but surface existing unresolved threads on the first check.
				seen: previous?.seen ?? {
					conversation: seen.conversation,
					userNotices: seen.userNotices,
					unresolved: new Map(),
				},
				controller: new AbortController(),
				state: "watching",
				nextCheck: 0,
			};
			watches.set(thread.url, watch);
			schedule(watch, ctx, thread.kind === "pr" ? 7 * MINUTE : MINUTE);
			return result(
				`${thread.url}: watching; first check ${new Date(watch.nextCheck).toISOString().slice(0, 16)}Z. ${AUTOMATIC_UPDATES}`,
			);
		},
	});
	pi.registerTool(tool);
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
