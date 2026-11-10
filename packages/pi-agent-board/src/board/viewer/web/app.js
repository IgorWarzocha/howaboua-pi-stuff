import {
	$,
	state,
	token,
	fragment,
	run,
	api,
	busy,
	changed,
} from "./session.js";
import { node, date } from "./posts.js";
import { createBoardRenderer } from "./render.js";
import { createNavigation } from "./navigation.js";
import { createUpdates } from "./updates.js";

const renderer = createBoardRenderer(
	() => loadList(),
	(...args) => openThread(...args),
);
const { loadList, openThread, loadBoard } = createNavigation(renderer);
const { refresh, moreThreads, moreReplies } = createUpdates(renderer);

$("boards").onchange = () => run(() => loadBoard($("boards").value));
$("author").onchange = () =>
	run(async () => {
		state.author = $("author").value;
		await loadList();
	});
$("search-form").onsubmit = (event) => {
	event.preventDefault();
	run(async () => {
		state.query = $("search").value.trim();
		state.searchFull = $("search-full").checked;
		await loadList();
	});
};
$("search-full").onchange = () =>
	run(async () => {
		state.searchFull = $("search-full").checked;
		await loadList();
	});
$("full-discussion").onchange = () =>
	run(() => openThread(state.thread, $("full-discussion").checked));
$("refresh").onclick = () => run(() => refresh(true));
$("back").onclick = () => {
	document.body.classList.remove("detail-open");
	const selected = [...$("threads").querySelectorAll("a")].find(
		(link) => link.dataset.thread === state.thread,
	);
	(selected || $("search")).focus();
};
$("more-threads").onclick = () => run(moreThreads);
$("more-replies").onclick = () => run(moreReplies);

async function start() {
	if (!token)
		throw new Error(
			"This link has no viewing key. Open the viewer again with /board.",
		);
	const index = await api("/api/boards");
	$("session").textContent = index.context.sessionName || "Current session";
	$("session").title = index.context.folder;
	$("boards").replaceChildren(
		...index.boards.map((board) => {
			const label =
				board.id === index.context.boardId
					? "Current session"
					: `${board.createdAt ? date(board.createdAt) : "Saved board"} · ${board.id.slice(0, 8)}`;
			const option = node("option", "", label);
			option.value = board.id;
			option.title = board.id;
			return option;
		}),
	);
	const requestedBoard = fragment.get("board");
	const board = index.boards.some((item) => item.id === requestedBoard)
		? requestedBoard
		: index.context.boardId;
	$("boards").value = board;
	await loadBoard(board);
	const requestedThread = fragment.get("thread");
	if (requestedThread) await openThread(requestedThread);
}
run(start);
setInterval(() => {
	if (!document.hidden && $("live").checked && state.board && !busy && !changed)
		run(() => refresh());
}, 5000);
