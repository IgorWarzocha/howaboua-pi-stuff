import { $, state, api, threadParams, setChanged, same } from "./session.js";
import { renderPost } from "./posts.js";

export function createUpdates({
	renderBoard,
	renderThreads,
	renderConversation,
}) {
	async function refresh(explicit = false) {
		const focused = document.activeElement;
		const focusKey =
			focused?.dataset?.channel !== undefined
				? ["channel", focused.dataset.channel]
				: focused?.dataset?.thread
					? ["thread", focused.dataset.thread]
					: null;
		const params = threadParams();
		const [detail, page, conversation] = await Promise.all([
			api("/api/board", { boardId: state.board }),
			api("/api/threads", params),
			state.thread
				? api("/api/thread", {
						boardId: state.board,
						id: state.thread,
						full: state.full ? "true" : "",
					})
				: Promise.resolve(null),
		]);
		if (!explicit && (state.threadPages > 1 || state.replyPages > 1)) {
			// Compare only loaded first pages. Never splice fresh cursors into an old tail.
			if (
				!same(detail, state.detail) ||
				!same(page, state.firstPage) ||
				!same(conversation, state.firstConversation)
			)
				setChanged(true);
			return;
		}
		if (!same(detail, state.detail)) {
			state.detail = detail;
			renderBoard();
		}
		if (!same(page, state.page)) {
			state.page = page;
			renderThreads();
		}
		if (conversation && !same(conversation, state.conversation)) {
			state.conversation = conversation;
			renderConversation();
		}
		state.threadPages = 1;
		state.replyPages = 1;
		state.firstPage = page;
		state.firstConversation = conversation;
		setChanged(false);
		if (focusKey && !focused.isConnected) {
			const target = [
				...document.querySelectorAll(`[data-${focusKey[0]}]`),
			].find((element) => element.dataset[focusKey[0]] === focusKey[1]);
			target?.focus({ preventScroll: true });
		}
	}

	async function moreThreads() {
		if (!state.page.nextCursor) return;
		const page = await api("/api/threads", {
			...threadParams(),
			cursor: state.page.nextCursor,
		});
		if (state.threadPages === 1) state.firstPage = state.page;
		state.page = {
			threads: [
				...state.page.threads,
				...page.threads.filter(
					(thread) => !state.page.threads.some((old) => old.id === thread.id),
				),
			],
			nextCursor: page.nextCursor,
		};
		state.threadPages++;
		renderThreads();
	}
	async function moreReplies() {
		if (!state.conversation.nextCursor) return;
		const page = await api("/api/thread", {
			boardId: state.board,
			id: state.thread,
			full: state.full ? "true" : "",
			cursor: state.conversation.nextCursor,
		});
		if (state.replyPages === 1) state.firstConversation = state.conversation;
		const replies = page.replies.filter(
			(post) => !state.conversation.replies.some((old) => old.id === post.id),
		);
		state.conversation = {
			...state.conversation,
			replies: [...state.conversation.replies, ...replies],
			nextCursor: page.nextCursor,
		};
		state.replyPages++;
		$("posts").append(...replies.map((post) => renderPost(post, false)));
		$("more-replies").hidden = !page.nextCursor;
	}

	return { refresh, moreThreads, moreReplies };
}
