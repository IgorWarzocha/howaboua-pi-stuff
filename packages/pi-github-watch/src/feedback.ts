import {
	arr,
	bool,
	compile,
	int,
	nul,
	obj,
	type Static,
	str,
	union,
	type Validator,
} from "@earendil-works/pi-schema";
import type { Thread } from "./github.js";

const pageInfo = obj(
	{
		hasNextPage: bool(),
		endCursor: union([str(), nul()]),
	},
	{ open: true },
);
const commentProperties = {
	id: str(),
	updatedAt: str(),
	viewerDidAuthor: bool(),
};
const comment = obj(
	{
		...commentProperties,
		body: str(),
		author: union([
			obj({ __typename: str(), login: str() }, { open: true }),
			nul(),
		]),
	},
	{ open: true },
);
const reviewComment = obj(
	{
		...commentProperties,
		url: str(),
		state: str(),
	},
	{ open: true },
);
const reviewThread = obj(
	{
		id: str(),
		isResolved: bool(),
		comments: obj(
			{
				nodes: arr(reviewComment),
				pageInfo,
			},
			{ open: true },
		),
	},
	{ open: true },
);
const review = obj(
	{
		...commentProperties,
		state: str(),
		body: str(),
		comments: obj({ totalCount: int({ minimum: 0 }) }, { open: true }),
	},
	{ open: true },
);
const commentPage = compile(
	obj({ nodes: arr(comment), pageInfo }, { open: true }),
);
const reviewPage = compile(
	obj({ nodes: arr(review), pageInfo }, { open: true }),
);
const reviewThreadPage = compile(
	obj({ nodes: arr(reviewThread), pageInfo }, { open: true }),
);
const reviewCommentPage = compile(
	obj({ nodes: arr(reviewComment), pageInfo }, { open: true }),
);
const paging = "pageInfo { hasNextPage endCursor }";
const commentFields = "id updatedAt viewerDidAuthor";
const reviewCommentFields = `${commentFields} url state`;

export interface ThreadSnapshot {
	conversation: Map<string, string>;
	userNotices: Map<string, string>;
	unresolved: Map<
		string,
		{
			version: string;
			url: string;
		}
	>;
}

function isReviewQuotaNotice(item: Static<typeof comment>): boolean {
	if (item.author?.__typename !== "Bot") return false;
	const body = item.body.trim().replace(/\s+/g, " ");
	// Match whole operational notices, never a quota phrase inside actual feedback.
	switch (item.author.login) {
		case "chatgpt-codex-connector":
			return (
				body ===
				"Codex usage limits have been reached for code reviews. Please check with the admins of this repo to increase the limits by adding credits. Credits must be used to enable repository wide code reviews."
			);
		case "cursor":
			return /^<h3>Bugbot couldn't run - usage limit reached<\/h3> Bugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit\. A user or team admin can review and increase usage limits in the \[Cursor dashboard\]\(https:\/\/www\.cursor\.com\/dashboard\/spending\)\. \(requestId: [\w-]+\)$/.test(
				body,
			);
		case "coderabbitai":
			return /^<!-- This is an auto-generated reply by CodeRabbit --> <!-- CodeRabbit review command invocation: [\da-f-]+ --> <details> <summary>✅ Action performed<\/summary> Full review finished\. --- You're currently rate limited under our \[Fair Usage Limits Policy\]\(https:\/\/docs\.coderabbit\.ai\/management\/plans#fair-usage-limits-policy\)\. Your recent PR review activity is in the 95th percentile or higher among CodeRabbit users, so adaptive limits apply\. Your next review will be available in \d+ minutes?\. <\/details>$/.test(
				body,
			);
		default:
			return false;
	}
}

export async function threadSnapshot(
	gh: (args: string[]) => Promise<string>,
	thread: Thread,
): Promise<ThreadSnapshot> {
	const [owner, name] = thread.repo.split("/");
	const variables = [
		"-f",
		`owner=${owner}`,
		"-f",
		`name=${name}`,
		"-F",
		`number=${thread.number}`,
	];
	async function* pages<T>(
		query: string,
		select: string,
		args: string[],
		validator: Validator<{ nodes: T[]; pageInfo: Static<typeof pageInfo> }>,
		cursor: string | null = null,
	) {
		do {
			const value: unknown = JSON.parse(
				await gh([
					"api",
					"graphql",
					"-f",
					`query=${query}`,
					...args,
					...(cursor ? ["-f", `cursor=${cursor}`] : []),
					"--jq",
					select,
				]),
			);
			if (!validator.check(value))
				throw new Error("Invalid GitHub feedback metadata. Retry the watch.");
			yield value.nodes;
			const next = value.pageInfo;
			if (!next.hasNextPage) return;
			if (!next.endCursor || next.endCursor === cursor)
				throw new Error(
					"Incomplete GitHub feedback metadata. Retry the watch.",
				);
			cursor = next.endCursor;
		} while (cursor);
	}
	function connection(field: string) {
		return `query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
			repository(owner:$owner,name:$name) {
				${thread.kind === "pr" ? "pullRequest" : "issue"}(number:$number) { ${field} }
			}
		}`;
	}
	const path = `.data.repository.${thread.kind === "pr" ? "pullRequest" : "issue"}`;
	const snapshot: ThreadSnapshot = {
		conversation: new Map(),
		userNotices: new Map(),
		unresolved: new Map(),
	};
	for await (const nodes of pages(
		connection(
			`comments(first:100,after:$cursor) { nodes { ${commentFields} body author { __typename login } } ${paging} }`,
		),
		`${path}.comments`,
		variables,
		commentPage,
	)) {
		for (const item of nodes) {
			if (item.viewerDidAuthor) continue;
			const audience = isReviewQuotaNotice(item)
				? snapshot.userNotices
				: snapshot.conversation;
			audience.set(item.id, item.updatedAt);
		}
	}
	if (thread.kind === "issue") return snapshot;
	for await (const nodes of pages(
		connection(
			`reviews(first:100,after:$cursor) { nodes { ${commentFields} state body comments { totalCount } } ${paging} }`,
		),
		`${path}.reviews`,
		variables,
		reviewPage,
	)) {
		for (const item of nodes) {
			// Inline review receipts duplicate the threads below; keep standalone feedback and verdicts.
			if (item.viewerDidAuthor || item.state === "PENDING") continue;
			if (
				item.state === "COMMENTED" &&
				(item.comments.totalCount > 0 || !item.body.trim())
			)
				continue;
			snapshot.conversation.set(item.id, `${item.updatedAt}:${item.state}`);
		}
	}
	for await (const nodes of pages(
		connection(
			`reviewThreads(first:100,after:$cursor) { nodes { id isResolved comments(first:100) { nodes { ${reviewCommentFields} } ${paging} } } ${paging} }`,
		),
		`${path}.reviewThreads`,
		variables,
		reviewThreadPage,
	)) {
		for (const item of nodes) {
			if (item.isResolved) continue;
			const comments: Static<typeof reviewComment>[] = [...item.comments.nodes];
			if (item.comments.pageInfo.hasNextPage) {
				if (!item.comments.pageInfo.endCursor)
					throw new Error(
						"Incomplete GitHub review comments. Retry the watch.",
					);
				for await (const more of pages(
					`query($id:ID!,$cursor:String) { node(id:$id) { ... on PullRequestReviewThread { comments(first:100,after:$cursor) { nodes { ${reviewCommentFields} } ${paging} } } } }`,
					".data.node.comments",
					["-f", `id=${item.id}`],
					reviewCommentPage,
					item.comments.pageInfo.endCursor,
				))
					comments.push(...more);
			}
			const submitted = comments.filter((entry) => entry.state !== "PENDING");
			const first = submitted[0];
			if (!first) continue;
			snapshot.unresolved.set(item.id, {
				url: first.url,
				version: JSON.stringify(
					submitted
						.filter((entry) => !entry.viewerDidAuthor)
						.map((entry) => [entry.id, entry.updatedAt]),
				),
			});
		}
	}
	return snapshot;
}
