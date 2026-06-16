// Shell tokenization is intentionally lightweight: it only needs enough fidelity
// to classify obvious read/list/search commands for compact Codex-style rendering.
export function shellSplit(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;

	const pushCurrent = () => {
		if (current.length > 0) {
			tokens.push(current);
			current = "";
		}
	};

	for (let index = 0; index < input.length; index++) {
		const char = input[index]!;
		const next = (input[index + 1])!;

		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			if (!quote) {
				escaping = true;
				continue;
			}
			if (quote === '"') {
				if (next && (next === "\\" || next === '"' || next === "$" || next === "`")) {
					escaping = true;
					continue;
				}
				current += char;
				continue;
			}
		}

		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (char === "&" && next === "&") {
			pushCurrent();
			tokens.push("&&");
			index += 1;
			continue;
		}
		if (char === "|" && next === "|") {
			pushCurrent();
			tokens.push("||");
			index += 1;
			continue;
		}
		if (char === "|" || char === ";") {
			pushCurrent();
			tokens.push(char);
			continue;
		}
		if (char === "\r" || char === "\n") {
			pushCurrent();
			if (char === "\r" && next === "\n") index += 1;
			tokens.push(";");
			continue;
		}

		if (/\s/.test(char)) {
			pushCurrent();
			continue;
		}

		current += char;
	}

	pushCurrent();
	return tokens;
}

export function shellQuote(token: string): string {
	if (token.length === 0) return "''";
	if (canEmitUnquoted(token)) return token;
	return `'${token.replace(/'/g, `'"'"'`)}'`;
}

function canEmitUnquoted(token: string): boolean {
	for (const char of token) {
		if (!isUnquotedOk(char)) return false;
	}
	return true;
}

function isUnquotedOk(char: string): boolean {
	return /^[+\-./:@\]_0-9A-Za-z]$/.test(char);
}

export function joinCommandTokens(tokens: string[]): string {
	return tokens
		.map((token) => (token === "&&" || token === "||" || token === "|" || token === ";" ? token : shellQuote(token)))
		.join(" ");
}

export function normalizeTokens(tokens: string[]): string[] {
	if (tokens.length >= 3 && (tokens[0] === "yes" || tokens[0] === "y" || tokens[0] === "no" || tokens[0] === "n") && tokens[1] === "|") {
		return normalizeTokens(tokens.slice(2));
	}
	const shell = tokens[0]!?.replace(/\\/g, "/").split("/").pop();
	if (
		tokens.length === 3 &&
		(shell === "bash" || shell === "zsh" || shell === "sh") &&
		(tokens[1] === "-c" || tokens[1] === "-lc")
	) {
		return normalizeTokens(shellSplit(tokens[2]!));
	}
	return tokens;
}

export function splitOnConnectors(tokens: string[]): string[][] {
	const parts: string[][] = [];
	let current: string[] = [];
	for (const token of tokens) {
		if (token === "&&" || token === "||" || token === "|" || token === ";") {
			if (current.length > 0) {
				parts.push(current);
				current = [];
			}
			continue;
		}
		current.push(token);
	}
	if (current.length > 0) {
		parts.push(current);
	}
	return parts;
}

export function shortDisplayPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
	const parts = normalized
		.split("/")
		.filter((part) => part.length > 0 && part !== "src" && part !== "dist" && part !== "build" && part !== "node_modules");
	return parts[parts.length - 1] ?? normalized;
}

export function joinPaths(base: string, extra: string): string {
	if (isAbsoluteLike(extra)) return extra;
	const left = base.replace(/\\/g, "/").replace(/\/$/, "");
	const right = extra.replace(/\\/g, "/").replace(/^\.\//, "");
	return `${left}/${right}`;
}

export function isAbsoluteLike(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}
