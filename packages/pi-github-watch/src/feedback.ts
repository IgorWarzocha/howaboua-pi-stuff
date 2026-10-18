import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
import type { Thread } from "./github.js";

const pageInfo = Type.Object({
	hasNextPage: Type.Boolean(),
	endCursor: Type.Union([Type.String(), Type.Null()]),
});
const comment = Type.Object({
	id: Type.String(),
	updatedAt: Type.String(),
	viewerDidAuthor: Type.Boolean(),
});
const reviewComment = Type.Object({
	...comment.properties,
	url: Type.String(),
	state: Type.String(),
});
const reviewThread = Type.Object({
	id: Type.String(),
	isResolved: Type.Boolean(),
	comments: Type.Object({
		nodes: Type.Array(reviewComment),
		pageInfo,
	}),
});
const review = Type.Object({
	...comment.properties,
	state: Type.String(),
	body: Type.String(),
	comments: Type.Object({ totalCount: Type.Integer({ minimum: 0 }) }),
});
const paging = "pageInfo { hasNextPage endCursor }";
const commentFields = "id updatedAt viewerDidAuthor";
const reviewCommentFields = `${commentFields} url state`;

export interface ThreadSnapshot {
	conversation: Map<string, string>;
	unresolved: Map<string, { version: string; url: string }>;
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
	async function* pages<T extends TSchema>(
		query: string,
		select: string,
		args: string[],
		node: T,
		cursor: string | null = null,
	) {
		const schema = Type.Object({ nodes: Type.Array(node), pageInfo });
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
			if (!Check(schema, value))
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
		comment,
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
		review,
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
		reviewThread,
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
					reviewComment,
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
