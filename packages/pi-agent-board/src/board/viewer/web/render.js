import { $, state, run, selectionURL } from "./session.js";
import {
	node,
	shortName,
	author,
	date,
	empty,
	statusLabel,
	renderPost,
} from "./posts.js";

export function createBoardRenderer(loadList, openThread) {
	function renderBoard() {
		const detail = state.detail;
		const channels = [
			{ name: "", label: "All activity" },
			...detail.channels.map((channel) => ({
				name: channel.name,
				label: channel.name,
				posts: channel.posts,
			})),
		];
		$("channels").replaceChildren(
			...channels.map((channel) => {
				const button = node("button", "", channel.label);
				button.type = "button";
				button.dataset.channel = channel.name;
				button.setAttribute(
					"aria-current",
					String(state.channel === channel.name),
				);
				if (channel.posts !== undefined)
					button.append(node("small", "", String(channel.posts)));
				button.onclick = () =>
					run(async () => {
						state.channel = channel.name;
						await loadList();
						renderBoard();
					});
				return button;
			}),
		);
		// Polling never replaces focused controls when their options have not changed.
		const options = [
			{ name: "", label: "All agents" },
			...detail.agents.map((agent) => ({
				name: agent.name,
				label: shortName(agent.name),
			})),
		];
		const signature = JSON.stringify(options);
		if ($("author").dataset.options !== signature) {
			$("author").replaceChildren(
				...options.map((option) => {
					const element = node("option", "", option.label);
					element.value = option.name;
					element.title = option.name;
					return element;
				}),
			);
			$("author").dataset.options = signature;
		}
		$("author").value = state.author;
		const watching = detail.subscriptions.filter(
			(subscription) => subscription.enabled,
		);
		$("subscriptions").replaceChildren(
			...watching.map((subscription) => {
				const line = node("p");
				line.append(
					author(subscription.agent),
					document.createTextNode(` watches ${subscription.target}`),
				);
				return line;
			}),
		);
		$("watching").hidden = !watching.length;
	}

	function renderThreads() {
		$("list-title").textContent = state.channel || "All activity";
		$("threads").replaceChildren(
			...state.page.threads.map((thread) => {
				const link = node("a", "thread");
				link.href = selectionURL(thread.id);
				link.dataset.thread = thread.id;
				link.setAttribute("aria-current", String(thread.id === state.thread));
				const meta = node("div", "thread-meta");
				meta.append(
					author(thread.author),
					node("span", "", date(thread.lastActivity)),
				);
				const foot = node("div", "thread-foot");
				foot.append(
					statusLabel(thread.status),
					node("span", "", thread.channel),
					node(
						"span",
						"",
						`${thread.replies} ${thread.replies === 1 ? "reply" : "replies"}`,
					),
				);
				if (thread.summarized) foot.append(node("span", "", "Summary"));
				link.append(meta, node("p", "thread-preview", thread.preview), foot);
				link.onclick = (event) => {
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
						return;
					event.preventDefault();
					run(() => openThread(thread.id));
				};
				return link;
			}),
		);
		if (!state.page.threads.length)
			empty(
				$("threads"),
				state.query || state.author ? "No matches" : "No posts",
			);
		$("more-threads").hidden = !state.page.nextCursor;
	}

	function renderConversation() {
		const conversation = state.conversation;
		const summary = conversation.summary;
		$("thread-status").replaceChildren(statusLabel(conversation.status));
		$("discussion-mode").hidden = !summary;
		$("full-discussion").checked = state.full;
		const snapshot = $("summary-snapshot");
		snapshot.hidden = !summary;
		snapshot.textContent = summary
			? `Summary saved ${date(summary.createdAt)} · ${summary.provider}/${summary.model} · ${summary.reasoning} · Through ${summary.throughMessageId}`
			: "";
		if (summary?.hasNewerPosts)
			snapshot.prepend(node("strong", "", "New replies after this summary. "));
		$("posts").replaceChildren(
			...(conversation.root
				? [renderPost(conversation.root, true)]
				: summary
					? [renderPost(summary, false, true)]
					: []),
			...conversation.replies.map((post) => renderPost(post, false)),
		);
		$("more-replies").hidden = !conversation.nextCursor;
	}

	return { renderBoard, renderThreads, renderConversation };
}
