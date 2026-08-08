export function globMatcher(glob: string): (value: string) => boolean {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	const expression = new RegExp(`^${escaped}$`, "i");
	return (value) => expression.test(value);
}
