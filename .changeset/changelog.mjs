import githubChangelog from "@changesets/changelog-github";

export default {
	...githubChangelog,
	async getReleaseLine(changeset, type, options) {
		const rendered = await githubChangelog.getReleaseLine(changeset, type, options);
		if (!/^\s*- - /.test(rendered)) return rendered;
		// List summaries already own their bullets; remove Changesets' outer list.
		return rendered.replace(/^(\s*)- (?=- )/, "$1").replace(/^ {2}/gm, "");
	},
};
