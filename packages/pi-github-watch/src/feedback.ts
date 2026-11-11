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
const comment = obj(commentProperties, { open: true });
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
	unresolved: Map<
		string,
		{
			version: string;
			url: string;
		}
	>;
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
				throw new Error(
					"GitHub returned invalid feedback metadata. Retry the watch.",
				);
			yield value.nodes;
			const next = value.pageInfo;
			if (!next.hasNextPage) return;
			if (!next.endCursor || next.endCursor === cursor)
				throw new Error(
					"GitHub returned incomplete feedback metadata. Retry the watch.",
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
		unresolved: new Map(),
	};
	for await (const nodes of pages(
		connection(
			`comments(first:100,after:$cursor) { nodes { ${commentFields} } ${paging} }`,
		),
		`${path}.comments`,
		variables,
		commentPage,
	)) {
		for (const item of nodes)
			if (!item.viewerDidAuthor)
				snapshot.conversation.set(item.id, item.updatedAt);
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
						"GitHub returned incomplete review comments. Retry the watch.",
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
