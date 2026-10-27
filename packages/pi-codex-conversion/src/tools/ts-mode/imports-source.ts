import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { API } from "tsrs/async";
import type { Node } from "tsrs/ast";
import type { TsRuntime } from "./runtime.ts";
import type { TsImportOptions } from "./imports.ts";
import { resolveTsSource, withTsImportApi } from "./imports-api.ts";
import { relocateCommonJsModule } from "./imports-commonjs.ts";
import { cacheExactNpmImport } from "../code-mode/npm-cache.ts";

/** Compile trusted local TS, including enums; never rely on Node's type stripping. */
export async function compileTsImportSource(
	url: string,
	options: TsImportOptions,
	resolveImport: (specifier: string, options: TsImportOptions, compiler?: { api: API; runtime: TsRuntime }, mode?: "import" | "require") => Promise<string>,
	onNpmTypes?: (specifier: string, path: string) => void,
): Promise<string> {
	const directory = join(options.sourceDir ?? join(options.cacheDir, "source"), randomUUID());
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const outputs = options.sourceModules ?? new Map<string, string>();
	const added: string[] = [];
	return withTsImportApi(options, async (api, runtime) => {
		const { ModuleKind, ModuleResolutionKind } = runtime.api;
		const { isCallExpression, isExportDeclaration, isImportDeclaration, isMetaProperty, isPropertyAccessExpression, isStringLiteral, ScriptTarget, SyntaxKind } = runtime.ast;
		const visit = async (sourceUrl: string): Promise<string> => {
			options.signal?.throwIfAborted();
			const existing = outputs.get(sourceUrl);
			if (existing) return existing;
			const path = fileURLToPath(sourceUrl);
			const source = await readFile(path, "utf8");
			const snapshot = await api.createSnapshot({
				fileSystem: runtime.fs.createFileSystemLayer([[path, source]]),
				createPrograms: [{ rootFiles: [path], compilerOptions: { noLib: true, noResolve: true, types: [], module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext } }],
			});
			let commonjs: boolean;
			const references: { specifier: string; start: number; end: number; dynamic: boolean; typeOnly: boolean }[] = [];
			const edits: { start: number; end: number; text: string }[] = [];
			try {
				const program = snapshot.operation.createdPrograms?.[0];
				const file = await program?.getSourceFile(path);
				const metadata = await program?.getSourceFileMetadata(path);
				if (!file || !metadata) throw new Error(`TypeScript could not determine module format for ${path}`);
				commonjs = metadata.impliedNodeFormat === ModuleKind.CommonJS;
				const walk = (node: Node): void => {
					if (isPropertyAccessExpression(node) && isMetaProperty(node.expression) && node.expression.keywordToken === SyntaxKind.ImportKeyword && node.name.text === "url") {
						edits.push({ start: node.getStart(file), end: node.end, text: JSON.stringify(sourceUrl) });
					}
					if ((isImportDeclaration(node) || isExportDeclaration(node)) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
						const typeOnly = isImportDeclaration(node) ? node.importClause?.phaseModifier === SyntaxKind.TypeKeyword : node.isTypeOnly;
						references.push({ specifier: node.moduleSpecifier.text, start: node.moduleSpecifier.getStart(file), end: node.moduleSpecifier.end, dynamic: false, typeOnly });
					}
					if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
						const argument = node.arguments[0];
						if (!argument || !isStringLiteral(argument)) throw new Error(`Computed dynamic imports in local TypeScript modules are unavailable: ${path}. Use a literal specifier or import dynamically in the cell.`);
						references.push({ specifier: argument.text, start: argument.getStart(file), end: argument.end, dynamic: true, typeOnly: false });
					}
					node.forEachChild(walk);
				};
				walk(file);
			} finally { await snapshot.dispose(); }
			const target = pathToFileURL(join(directory, `${outputs.size}.${commonjs ? "cjs" : "mjs"}`)).href;
			outputs.set(sourceUrl, target); // Cycles must see the eventual URL before traversing dependencies.
			added.push(sourceUrl);
			for (const reference of references) {
				const requireMode = commonjs && !reference.dynamic;
				if (onNpmTypes && reference.specifier.startsWith("npm:")) {
					const location = await cacheExactNpmImport(reference.specifier, options.cacheDir, options.signal);
					options.onNpmImport?.(reference.specifier);
					const resolver = await api.createModuleResolver({ module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext });
					try {
						const types = (await resolver.resolveModuleName(location.bare, location.cwd, requireMode ? ModuleKind.CommonJS : ModuleKind.ESNext)).resolvedModule;
						if (types) onNpmTypes(reference.specifier, types.resolvedFileName);
					} finally { await resolver.dispose(); }
				}
				if (reference.typeOnly) continue;
				// Reuse the leased API: borrowing the compiler queue again would deadlock.
				const resolved = await resolveImport(reference.specifier, { ...options, cwd: dirname(path) }, { api, runtime }, requireMode ? "require" : "import");
				const compiled = resolved.startsWith("file:") && /(?<!\.d)\.(?:ts|mts|cts)$/.test(fileURLToPath(resolved)) ? await visit(resolved) : resolved;
				edits.push({ ...reference, text: JSON.stringify(commonjs && !reference.dynamic && compiled.startsWith("file:") ? fileURLToPath(compiled) : compiled) });
			}
			let rewritten = source;
			for (const edit of edits.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
			const emitted = await api.transpileModule(rewritten, { fileName: path, compilerOptions: { module: commonjs ? ModuleKind.NodeNext : ModuleKind.ESNext, target: ScriptTarget.ESNext }, reportDiagnostics: true });
			const errors = emitted.diagnostics?.filter(value => value.category === 1);
			if (errors?.length) throw new Error(errors.map(value => value.text).join("\n"));
			const javascript = commonjs ? await relocateCommonJsModule(api, runtime, path, emitted.outputText, async (specifier) => {
				let dependency = resolve(dirname(path), specifier);
				if (!/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(dependency)) return dependency;
				try { await access(dependency); }
				catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
					const substituted = /\.(?:js|mjs|cjs)$/.test(specifier) ? await resolveTsSource(specifier, dirname(path), api, runtime, "require") : undefined;
					if (!substituted || !/(?<!\.d)\.(?:ts|mts|cts)$/.test(substituted)) return dependency;
					dependency = substituted;
				}
				if (!/(?<!\.d)\.(?:ts|mts|cts)$/.test(dependency)) return dependency;
				return fileURLToPath(await visit(pathToFileURL(dependency).href));
			}) : emitted.outputText;
			await writeFile(fileURLToPath(target), javascript, { mode: 0o600 });
			return target;
		};
		try {
			const result = await visit(url);
			if (added.length === 0) await rm(directory, { recursive: true, force: true });
			return result;
		}
		catch (error) {
			for (const source of added) outputs.delete(source);
			await rm(directory, { recursive: true, force: true });
			throw error;
		}
	});
}
