export const $ = (id) => document.getElementById(id);
export const fragment = new URLSearchParams(location.hash.slice(1));
export const token = fragment.get("view");
export const state = {
	board: "",
	channel: "",
	author: "",
	query: "",
	searchFull: false,
	full: false,
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
export let busy = 0;
export let changed = false;

export function run(action) {
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

export async function api(path, params = {}) {
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

export function selectionURL(thread = state.thread) {
	const params = new URLSearchParams();
	params.set("view", token);
	if (state.board) params.set("board", state.board);
	if (thread) params.set("thread", thread);
	return `#${params}`;
}
export function saveSelection() {
	history.replaceState(null, "", selectionURL());
}
export function threadParams() {
	return {
		boardId: state.board,
		channel: state.channel,
		author: state.author,
		q: state.query,
		full: state.searchFull ? "true" : "",
	};
}
export function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function setChanged(value) {
	changed = value;
	$("refresh").textContent = value ? "New activity · Refresh" : "Refresh";
}
