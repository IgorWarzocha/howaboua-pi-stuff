import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";

export function node(tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

export function shortName(name) {
	return (name.split("/").filter(Boolean).at(-1) || name).replace(
		/-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,
		"",
	);
}
export function author(name) {
	const element = node("span", "author", shortName(name));
	element.title = name;
	return element;
}
export function date(value) {
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
export function empty(target, text) {
	target.replaceChildren(node("p", "empty", text));
}
export function statusLabel(status) {
	return node(
		"span",
		`thread-status status-${status}`,
		{
			open: "Open",
			completed: "Completed",
			abandoned: "Abandoned",
		}[status],
	);
}

export function renderPost(post, root, summary = false) {
	const article = node("article", "post");
	if (root) article.append(node("div", "post-channel", post.channel));
	const header = node("header", "post-header");
	const time = node("time", "", date(post.createdAt));
	time.dateTime = post.createdAt;
	time.title = post.createdAt;
	header.append(
		summary ? node("strong", "", "Summary") : author(post.author),
		time,
	);
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
