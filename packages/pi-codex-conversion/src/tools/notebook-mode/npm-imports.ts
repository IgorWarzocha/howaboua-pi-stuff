import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withProjectStateLock } from "./project-state-lock.ts";
import { projectStatePaths } from "./project-state-format.ts";

const NPM_IMPORTS_SCHEMA = 1;
const MAX_IMPORTS = 1_000;
const MAX_SPECIFIER_BYTES = 1_024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IMPORT_LIST_BYTES = 12 * 1024;
const NPM_SPECIFIER = /^npm:[^\s"'`]+$/;

interface NpmImportsManifest {
	schema: number;
	project: string;
	imports: string[];
}

export function extractNotebookNpmImports(source: string): string[] {
	const imports = new Set<string>();
	for (const literal of stringLiterals(source)) {
		if (!isExactNpmSpecifier(literal.value) || Buffer.byteLength(literal.value) > MAX_SPECIFIER_BYTES) continue;
		const prefix = literal.maskedPrefix.trimEnd();
		if (/(?:^|[^\w$.])import\s*(?:\(\s*)?$|(?:^|[^\w$])from\s*$/.test(prefix)) imports.add(literal.value);
	}
	return [...imports].sort();
}

export function readNotebookNpmImports(identity: { project: string; agentDir: string }): string[] {
	const paths = npmImportPaths(identity);
	try {
		const text = readFileSync(paths.manifest, "utf8");
		if (Buffer.byteLength(text) > MAX_FILE_BYTES) return [];
		const value = JSON.parse(text) as unknown;
		return isNpmImportsManifest(value, resolve(identity.project)) ? value.imports : [];
	} catch {
		return [];
	}
}

export async function recordNotebookNpmImports(
	identity: { project: string; agentDir: string },
	imports: string[],
): Promise<string[]> {
	if (imports.length === 0) return readNotebookNpmImports(identity);
	const paths = npmImportPaths(identity);
	mkdirSync(paths.directory, { recursive: true });
	await withProjectStateLock(paths.lock, async () => {
		const combined = [...new Set([...readNotebookNpmImports(identity), ...imports])].sort();
		if (combined.length > MAX_IMPORTS) throw new Error(`Notebook npm inventory exceeds ${MAX_IMPORTS} imports`);
		writeManifest(paths.manifest, { schema: NPM_IMPORTS_SCHEMA, project: resolve(identity.project), imports: combined });
	});
	return readNotebookNpmImports(identity);
}

export async function resetNotebookNpmImports(identity: { project: string; agentDir: string }): Promise<void> {
	const paths = npmImportPaths(identity);
	mkdirSync(paths.directory, { recursive: true });
	await withProjectStateLock(paths.lock, async () => { rmSync(paths.manifest, { force: true }); });
}

export function formatNotebookNpmImportsNotice(imports: string[]): string {
	const prefix = `Available npm imports previously established in this project: ${imports.length === 0 ? "none" : boundedImportList(imports)}`;
	return `${prefix}. All npm packages are unsafe by default; ask the user before first use of any unlisted package and use an exact-version npm: specifier`;
}

function npmImportPaths(identity: { project: string; agentDir: string }) {
	const project = projectStatePaths(identity.project, identity.agentDir);
	return { ...project, manifest: join(project.directory, "npm-imports.json"), lock: join(project.directory, "npm-imports.lock") };
}

function writeManifest(path: string, manifest: NpmImportsManifest): void {
	const text = `${JSON.stringify(manifest, null, 2)}\n`;
	if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error("Notebook npm inventory is too large");
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, text, { mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function boundedImportList(imports: string[]): string {
	let output = "";
	let included = 0;
	for (const specifier of imports) {
		const next = output ? `${output}, ${specifier}` : specifier;
		if (Buffer.byteLength(next) > MAX_IMPORT_LIST_BYTES) break;
		output = next;
		included += 1;
	}
	return `${output || "none"}${included < imports.length ? `, and ${imports.length - included} more` : ""}`;
}

function isNpmImportsManifest(value: unknown, project: string): value is NpmImportsManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record["schema"] === NPM_IMPORTS_SCHEMA
		&& record["project"] === project
		&& Array.isArray(record["imports"])
		&& record["imports"].length <= MAX_IMPORTS
		&& record["imports"].every((specifier) =>
			typeof specifier === "string"
			&& isExactNpmSpecifier(specifier)
			&& Buffer.byteLength(specifier) <= MAX_SPECIFIER_BYTES);
}

function isExactNpmSpecifier(specifier: string): boolean {
	if (!NPM_SPECIFIER.test(specifier)) return false;
	const version = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
	return new RegExp(`^npm:(?:@[^/\\s]+/[^@/\\s]+|[^@/\\s]+)@${version}(?:/[^\\s]+)?$`).test(specifier);
}

function stringLiterals(source: string): Array<{ value: string; maskedPrefix: string }> {
	const output: Array<{ value: string; maskedPrefix: string }> = [];
	const masked = source.split("");
	for (let index = 0; index < source.length;) {
		const current = source[index]!;
		const next = source[index + 1];
		if (current === "/" && next === "/") {
			const end = source.indexOf("\n", index + 2);
			const stop = end === -1 ? source.length : end;
			for (let cursor = index; cursor < stop; cursor += 1) masked[cursor] = " ";
			index = stop;
			continue;
		}
		if (current === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			const stop = end === -1 ? source.length : end + 2;
			for (let cursor = index; cursor < stop; cursor += 1) if (source[cursor] !== "\n") masked[cursor] = " ";
			index = stop;
			continue;
		}
		if (current === "`") {
			const stop = skipDelimited(source, index, "`");
			for (let cursor = index; cursor < stop; cursor += 1) if (source[cursor] !== "\n") masked[cursor] = " ";
			index = stop;
			continue;
		}
		if (current === "/" && isRegexLiteralStart(source, index)) {
			let cursor = index + 1;
			let characterClass = false;
			while (cursor < source.length) {
				if (source[cursor] === "\\") cursor += 2;
				else if (source[cursor] === "[") { characterClass = true; cursor += 1; }
				else if (source[cursor] === "]") { characterClass = false; cursor += 1; }
				else if (source[cursor] === "/" && !characterClass) { cursor += 1; break; }
				else cursor += 1;
			}
			while (cursor < source.length && /[a-z]/i.test(source[cursor]!)) cursor += 1;
			for (let position = index; position < cursor; position += 1) if (source[position] !== "\n") masked[position] = " ";
			index = cursor;
			continue;
		}
		if (current !== '"' && current !== "'") {
			index += 1;
			continue;
		}
		const start = index;
		let value = "";
		let simple = true;
		index += 1;
		while (index < source.length) {
			const char = source[index]!;
			if (char === "\\") {
				simple = false;
				masked[index] = " ";
				if (index + 1 < source.length) masked[index + 1] = " ";
				index += 2;
				continue;
			}
			if (char === current) {
				masked[index] = " ";
				index += 1;
				break;
			}
			value += char;
			if (char !== "\n") masked[index] = " ";
			index += 1;
		}
		masked[start] = " ";
		if (simple) output.push({ value, maskedPrefix: masked.slice(0, start).join("") });
	}
	return output;
}

function skipDelimited(source: string, start: number, delimiter: string): number {
	let index = start + 1;
	while (index < source.length) {
		if (source[index] === "\\") index += 2;
		else if (source[index] === delimiter) return index + 1;
		else index += 1;
	}
	return source.length;
}

function isRegexLiteralStart(source: string, index: number): boolean {
	const previous = source.slice(0, index).trimEnd();
	if (!previous) return true;
	if ("([{:;,=!?&|+-*%^~<>".includes(previous.at(-1)!)) return true;
	return /(?:^|[^\w$])(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|else|do)$/.test(previous);
}
