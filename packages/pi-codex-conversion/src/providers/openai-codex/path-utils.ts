const PATH_SEPARATOR = "/";

export function normalizePath(value: string): string {
	if (!value) return ".";
	const normalized = value.replace(/\/+/g, PATH_SEPARATOR);
	if (normalized === PATH_SEPARATOR) return normalized;
	return normalized.replace(/\/+$/g, "") || PATH_SEPARATOR;
}

export function joinPaths(...parts: string[]): string {
	if (parts.length === 0) return ".";
	let result = parts[0] ?? "";
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i]!;
		if (!part) continue;
		if (!result || result.endsWith(PATH_SEPARATOR)) {
			result += part.replace(/^\/+/, "");
		} else {
			result += `${PATH_SEPARATOR}${part.replace(/^\/+/, "")}`;
		}
	}
	return normalizePath(result);
}

export function dirnamePath(value: string): string {
	const normalized = normalizePath(value);
	if (normalized === PATH_SEPARATOR) return PATH_SEPARATOR;
	const index = normalized.lastIndexOf(PATH_SEPARATOR);
	if (index < 0) return ".";
	if (index === 0) return PATH_SEPARATOR;
	return normalized.slice(0, index);
}

function splitPathSegments(value: string): string[] {
	const normalized = normalizePath(value);
	if (normalized === PATH_SEPARATOR) return [];
	return normalized.replace(/^\/+/, "").split(PATH_SEPARATOR).filter(Boolean);
}

export function relativePath(from: string, to: string): string {
	const normalizedFrom = normalizePath(from);
	const normalizedTo = normalizePath(to);
	if (normalizedFrom === normalizedTo) return "";
	const fromSegments = splitPathSegments(normalizedFrom);
	const toSegments = splitPathSegments(normalizedTo);
	let shared = 0;
	while (shared < fromSegments.length && shared < toSegments.length && fromSegments[shared] === toSegments[shared]!) {
		shared++;
	}
	const upSegments = new Array(fromSegments.length - shared).fill("..");
	const downSegments = toSegments.slice(shared);
	return [...upSegments, ...downSegments].join(PATH_SEPARATOR);
}
