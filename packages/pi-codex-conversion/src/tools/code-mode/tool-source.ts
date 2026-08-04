import { isCustomToolDefinition } from "./host-protocol.js";
import type { CodeModeToolDefinition } from "./types.js";

export function scopeAllToolsToDeferredCustom(
	source: string,
	tools: CodeModeToolDefinition[],
): string {
	const names = tools
		.filter(isCustomToolDefinition)
		.filter((tool) => tool.deferLoading)
		.map((tool) => tool.name);
	return `globalThis.ALL_TOOLS=globalThis.ALL_TOOLS.filter(({name})=>${JSON.stringify(names)}.includes(name));${source}`;
}

export function directToolYieldTime(
	code: string,
	tools: CodeModeToolDefinition[],
): number | null {
	const executableCode = maskJavaScriptCommentsAndStrings(code);
	let forced: number | undefined;
	for (const tool of tools) {
		if (tool.yieldTimeMs === undefined) continue;
		const name = escapeRegExp(tool.name);
		const directReference = new RegExp(
			`\\btools\\s*\\.\\s*${name}(?![a-zA-Z0-9_$])\\s*\\(`,
		);
		const bracketReference = new RegExp(
			`\\btools\\s*\\[\\s*(["'])${name}\\1\\s*\\]\\s*\\(`,
			"g",
		);
		if (
			!directReference.test(executableCode) &&
			!hasExecutableBracketReference(code, executableCode, bracketReference)
		)
			continue;
		forced =
			forced === undefined
				? tool.yieldTimeMs
				: Math.max(forced, tool.yieldTimeMs);
	}
	return forced ?? null;
}

function hasExecutableBracketReference(
	code: string,
	executableCode: string,
	pattern: RegExp,
): boolean {
	for (const match of code.matchAll(pattern)) {
		if (
			match.index !== undefined &&
			executableCode.slice(match.index, match.index + 5) === "tools"
		)
			return true;
	}
	return false;
}

function maskJavaScriptCommentsAndStrings(code: string): string {
	const output = code.split("");
	let state:
		| "code"
		| "line-comment"
		| "block-comment"
		| "string"
		| "regex"
		| "template" = "code";
	let quote = "";
	let regexClass = false;
	let templateExpressionDepth: number | undefined;
	const templateReturnDepths: Array<number | undefined> = [];
	for (let index = 0; index < code.length; index += 1) {
		const current = code[index]!;
		const next = code[index + 1];
		if (state === "template") {
			output[index] = current === "\n" || current === "\r" ? current : " ";
			if (current === "\\") {
				if (next !== undefined) output[index + 1] = " ";
				index += 1;
			} else if (current === "$" && next === "{") {
				output[index + 1] = " ";
				templateExpressionDepth = 1;
				state = "code";
				index += 1;
			} else if (current === "`") {
				templateExpressionDepth = templateReturnDepths.pop();
				state = "code";
			}
			continue;
		}
		if (state === "code") {
			if (templateExpressionDepth !== undefined && current === "{") {
				templateExpressionDepth += 1;
			} else if (templateExpressionDepth !== undefined && current === "}") {
				templateExpressionDepth -= 1;
				if (templateExpressionDepth === 0) {
					output[index] = " ";
					templateExpressionDepth = undefined;
					state = "template";
				}
			} else if (current === "/" && next === "/") {
				output[index] = output[index + 1] = " ";
				state = "line-comment";
				index += 1;
			} else if (current === "/" && next === "*") {
				output[index] = output[index + 1] = " ";
				state = "block-comment";
				index += 1;
			} else if (current === "/" && isRegexLiteralStart(code, index)) {
				output[index] = " ";
				regexClass = false;
				state = "regex";
			} else if (current === '"' || current === "'") {
				output[index] = " ";
				quote = current;
				state = "string";
			} else if (current === "`") {
				output[index] = " ";
				templateReturnDepths.push(templateExpressionDepth);
				templateExpressionDepth = undefined;
				state = "template";
			}
			continue;
		}
		if (state === "line-comment") {
			if (current === "\n" || current === "\r") state = "code";
			else output[index] = " ";
			continue;
		}
		if (state === "regex") {
			output[index] = current === "\n" || current === "\r" ? current : " ";
			if (current === "\\") {
				if (next !== undefined) output[index + 1] = " ";
				index += 1;
			} else if (current === "[") regexClass = true;
			else if (current === "]") regexClass = false;
			else if (current === "/" && !regexClass) state = "code";
			continue;
		}
		output[index] = current === "\n" || current === "\r" ? current : " ";
		if (state === "block-comment") {
			if (current === "*" && next === "/") {
				output[index + 1] = " ";
				state = "code";
				index += 1;
			}
			continue;
		}
		if (current === "\\") {
			if (next !== undefined) output[index + 1] = " ";
			index += 1;
		} else if (current === quote) {
			state = "code";
			quote = "";
		}
	}
	return output.join("");
}

function isRegexLiteralStart(code: string, index: number): boolean {
	const previous = code.slice(0, index).trimEnd();
	if (!previous) return true;
	if ("([{:;,=!?&|+-*%^~<>".includes(previous.at(-1)!)) return true;
	return /(?:^|[^\w$])(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(
		previous,
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
