import {
	$,
	state,
	api,
	saveSelection,
	threadParams,
	setChanged,
} from "./session.js";

export function createNavigation({
	renderBoard,
	renderThreads,
	renderConversation,
}) {
	function clearConversation() {
		state.thread = "";
		state.conversation = null;
		state.firstConversation = null;
		state.replyPages = 1;
		$("more-replies").hidden = true;
		document.body.classList.remove("detail-open");
		$("posts").replaceChildren();
		$("thread-status").replaceChildren();
		$("discussion-mode").hidden = true;
		$("summary-snapshot").hidden = true;
		saveSelection();
	}
	async function loadList() {
		const page = await api("/api/threads", threadParams());
		state.page = page;
		state.firstPage = page;
		state.threadPages = 1;
		clearConversation();
		renderThreads();
		$("threads").closest(".index").scrollTop = 0;
		setChanged(false);
		if (page.threads[0]) await openThread(page.threads[0].id);
	}
	async function openThread(id, full = false) {
		const conversation = await api("/api/thread", {
			boardId: state.board,
			id,
			full: full ? "true" : "",
		});
		state.full = full;
		state.thread = id;
		state.conversation = conversation;
		state.firstConversation = conversation;
		state.replyPages = 1;
		renderConversation();
		for (const link of $("threads").querySelectorAll("a"))
			link.setAttribute("aria-current", String(link.dataset.thread === id));
		saveSelection();
		document.body.classList.add("detail-open");
		$("conversation").scrollTop = 0;
		if (matchMedia("(max-width: 760px)").matches) {
			window.scrollTo(0, 0);
			$("back").focus();
		}
	}
	async function loadBoard(id) {
		const detail = await api("/api/board", { boardId: id });
		state.board = id;
		state.detail = detail;
		state.channel = "";
		state.author = "";
		renderBoard();
		await loadList();
	}

	return { clearConversation, loadList, openThread, loadBoard };
}
