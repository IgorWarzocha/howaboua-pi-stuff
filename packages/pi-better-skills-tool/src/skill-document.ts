const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export interface SkillDocument {
	frontmatter: Partial<Record<"name" | "description", string>>;
	body: string;
}

interface SkillFields {
	name: string;
	description: string;
	packageName: string;
	body: string;
}

function decodeQuotedScalar(
	value: string,
	path: string,
	field: string,
): string {
	if (value.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed !== "string") throw new Error();
			return parsed;
		} catch {
			throw new Error(`${path}: ${field} must be a valid quoted YAML string`);
		}
	}
	if (value.startsWith("'")) {
		if (!value.endsWith("'") || value.length < 2) {
			throw new Error(`${path}: ${field} must be a valid quoted YAML string`);
		}
		return value.slice(1, -1).replace(/''/g, "'");
	}
	return value;
}

function parseBlockScalar(
	lines: string[],
	start: number,
	parentIndent: number,
	style: string,
): { value: string; nextIndex: number } {
	const values: string[] = [];
	let commonIndent: number | undefined;
	let index = start;
	for (; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			values.push("");
			continue;
		}
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		if (indent <= parentIndent) break;
		commonIndent =
			commonIndent === undefined ? indent : Math.min(commonIndent, indent);
		values.push(line);
	}
	const indent = commonIndent ?? parentIndent + 1;
	const normalized = values.map((line) =>
		line.slice(Math.min(indent, line.length)),
	);
	const value =
		style === ">"
			? normalized.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ")
			: normalized.join("\n");
	return { value: value.trim(), nextIndex: index };
}

export function parseSkillDocument(
	content: string,
	label: string,
): SkillDocument {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") throw new Error(`${label}: missing YAML frontmatter`);
	const end = lines.findIndex(
		(line, index) => index > 0 && (line === "---" || line === "..."),
	);
	if (end < 0) throw new Error(`${label}: unterminated YAML frontmatter`);

	const fields: SkillDocument["frontmatter"] = {};
	for (let index = 1; index < end; index += 1) {
		const line = lines[index] ?? "";
		const match = /^(\s*)(name|description):\s*(.*)$/.exec(line);
		if (!match) continue;
		const whitespace = match[1] ?? "";
		const field = match[2] as "name" | "description";
		const rawValue = match[3] ?? "";
		const block = /^([>|])[-+]?\s*$/.exec(rawValue);
		if (block) {
			const parsed = parseBlockScalar(
				lines.slice(0, end),
				index + 1,
				whitespace.length,
				block[1] ?? "|",
			);
			fields[field] = parsed.value;
			index = parsed.nextIndex - 1;
			continue;
		}
		fields[field] = decodeQuotedScalar(rawValue.trim(), label, field);
	}
	return {
		frontmatter: fields,
		body: lines
			.slice(end + 1)
			.join("\n")
			.trim(),
	};
}

export function validateSkill(skill: SkillFields): void {
	const errors: string[] = [];
	if (!skill.name) errors.push("name is required");
	else {
		if (skill.name.length > MAX_NAME_LENGTH)
			errors.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
			errors.push(
				"name must contain only lowercase letters, numbers, and single hyphens",
			);
		}
	}
	if (!skill.description?.trim()) errors.push("description is required");
	else if (skill.description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
	}
	if (!skill.body) errors.push("Markdown body is required");
	if (errors.length)
		throw new Error(`${skill.packageName}: ${errors.join("; ")}`);
}
