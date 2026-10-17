export type PulseFrontmatter = Record<string, string | boolean>;

const FRONTMATTER_START = "---";

function parseValue(raw: string): string | boolean {
	const value = raw.trim().replace(/^['"]|['"]$/g, "");
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}

export function parsePulseFrontmatter(text: string): {
	data: PulseFrontmatter;
	body: string;
} {
	const normalized = text.replace(/\r\n/g, "\n");
	if (!normalized.startsWith(`${FRONTMATTER_START}\n`))
		return { data: {}, body: text };

	const end = normalized.indexOf(
		`\n${FRONTMATTER_START}\n`,
		FRONTMATTER_START.length + 1,
	);
	if (end < 0) return { data: {}, body: text };

	const raw = normalized.slice(FRONTMATTER_START.length + 1, end);
	const data: PulseFrontmatter = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;
		const key = trimmed.slice(0, colon).trim();
		if (!key) continue;
		data[key] = parseValue(trimmed.slice(colon + 1));
	}

	return {
		data,
		body: normalized.slice(end + FRONTMATTER_START.length + 2).trimStart(),
	};
}
