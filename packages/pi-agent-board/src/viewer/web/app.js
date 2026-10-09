import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";

const $ = (id) => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get("view");
const state = {
	board: "",
	channel: "",
	author: "",
	query: "",
	thread: "",
	detail: null,
	page: null,
	conversation: null,
	firstPage: null,
	firstConversation: null,
	threadPages: 1,
	replyPages: 1,
};
let queue = Promise.resolve();
let busy = 0;
let changed = false;

function run(action) {
	busy++;
	queue = queue.then(async () => {
		try {
			await action();
			$("status").textContent = "";
		} catch (error) {
			$("status").textContent = error.message;
		} finally {
			busy--;
		}
	});
	return queue;
}

async function api(path, params = {}) {
	const url = new URL(path, location.origin);
	for (const [key, value] of Object.entries(params))
		if (value) url.searchParams.set(key, value);
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
		cache: "no-store",
		signal: AbortSignal.timeout(10_000),
	});
	const data = await response.json();
	if (!response.ok) {
		if (response.status === 401) $("live").checked = false;
		throw new Error(
			typeof data.error === "string"
				? data.error
				: `Request failed (${response.status}).`,
		);
	}
	return data;
}

function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function shortName(name) {
	return (name.split("/").filter(Boolean).at(-1) || name).replace(
		/-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,
		"",
	);
}
function author(name) {
	const element = node("span", "author", shortName(name));
	element.title = name;
	return element;
}
function date(value) {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? value
		: parsed.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
}
function empty(target, text) {
	target.replaceChildren(node("p", "empty", text));
}
function selectionURL(thread = state.thread) {
	const params = new URLSearchParams();
	params.set("view", token);
	if (state.board) params.set("board", state.board);
	if (thread) params.set("thread", thread);
	return `#${params}`;
}
function saveSelection() {
	history.replaceState(null, "", selectionURL());
}
function threadParams() {
	return {
		boardId: state.board,
		channel: state.channel,
		author: state.author,
		q: state.query,
	};
}
function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

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
				node("span", "", thread.channel),
				node(
					"span",
					"",
					`${thread.replies} ${thread.replies === 1 ? "reply" : "replies"}`,
				),
			);
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

function renderPost(post, root) {
	const article = node("article", "post");
	if (root) article.append(node("div", "post-channel", post.channel));
	const header = node("header", "post-header");
	const time = node("time", "", date(post.createdAt));
	time.dateTime = post.createdAt;
	time.title = post.createdAt;
	header.append(author(post.author), time);
	const body = node("div", "prose");
	body.innerHTML = DOMPurify.sanitize(
		marked.parse(post.text, { async: false }),
		{
			ALLOWED_TAGS: [
				"p",
				"br",
				"hr",
				"strong",
				"em",
				"del",
				"blockquote",
				"pre",
				"code",
				"ul",
				"ol",
				"li",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"a",
				"table",
				"thead",
				"tbody",
				"tr",
				"th",
				"td",
			],
			ALLOWED_ATTR: ["href", "title", "start", "colspan", "rowspan"],
			ALLOW_DATA_ATTR: false,
		},
	);
	for (const link of body.querySelectorAll("a")) {
		const href = link.getAttribute("href");
		// Relative links could carry the capability fragment to another local page.
		if (!href || !/^(https?:|mailto:)/i.test(href))
			link.removeAttribute("href");
		else {
			link.rel = "noopener noreferrer";
			link.target = "_blank";
		}
	}
	article.append(header, body);
	return article;
}
function renderConversation() {
	const conversation = state.conversation;
	$("posts").replaceChildren(
		renderPost(conversation.root, true),
		...conversation.replies.map((post) => renderPost(post, false)),
	);
	$("more-replies").hidden = !conversation.nextCursor;
}
function clearConversation() {
	state.thread = "";
	state.conversation = null;
	state.firstConversation = null;
	state.replyPages = 1;
	$("more-replies").hidden = true;
	document.body.classList.remove("detail-open");
	$("posts").replaceChildren();
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
async function openThread(id) {
	const conversation = await api("/api/thread", { boardId: state.board, id });
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
function setChanged(value) {
	changed = value;
	$("refresh").textContent = value ? "New activity · Refresh" : "Refresh";
}

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
			? api("/api/thread", { boardId: state.board, id: state.thread })
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
		const target = [...document.querySelectorAll(`[data-${focusKey[0]}]`)].find(
			(element) => element.dataset[focusKey[0]] === focusKey[1],
		);
		target?.focus({ preventScroll: true });
	}
}

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
		await loadList();
	});
};
$("refresh").onclick = () => run(() => refresh(true));
$("back").onclick = () => {
	document.body.classList.remove("detail-open");
	const selected = [...$("threads").querySelectorAll("a")].find(
		(link) => link.dataset.thread === state.thread,
	);
	(selected || $("search")).focus();
};
$("more-threads").onclick = () =>
	run(async () => {
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
	});
$("more-replies").onclick = () =>
	run(async () => {
		if (!state.conversation.nextCursor) return;
		const page = await api("/api/thread", {
			boardId: state.board,
			id: state.thread,
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
	});

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
