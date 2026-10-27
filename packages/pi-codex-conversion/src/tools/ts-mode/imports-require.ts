import { dirname, resolve } from "node:path";
import type { API } from "tsrs/async";
import type { CallExpression, Node, StringLiteral } from "tsrs/ast";
import type { TsRuntime } from "./runtime.ts";

/** Bind emitted CommonJS so erased TypeScript declarations cannot hide Node's require. */
export async function anchorCommonJsRequires(api: API, runtime: TsRuntime, path: string, source: string): Promise<string> {
	const snapshot = await api.createSnapshot({
		fileSystem: runtime.fs.createFileSystemLayer([[path, source]]),
		createPrograms: [{ rootFiles: [path], compilerOptions: { noLib: true, noResolve: true, types: [], module: runtime.api.ModuleKind.NodeNext, moduleResolution: runtime.api.ModuleResolutionKind.NodeNext } }],
	});
	try {
		const program = snapshot.operation.createdPrograms?.[0];
		const file = await program?.getSourceFile(path);
		if (!program || !file) throw new Error(`TypeScript could not resolve require bindings in ${path}`);
		const { isCallExpression, isIdentifier, isStringLiteral } = runtime.ast;
		const calls: { call: CallExpression; argument: StringLiteral }[] = [];
		function walk(node: Node): void {
			if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === "require") {
				const argument = node.arguments[0];
				if (argument && isStringLiteral(argument) && /^\.{1,2}\//.test(argument.text)) calls.push({ call: node, argument });
			}
			node.forEachChild(walk);
		}
		walk(file);
		const symbols = await program.getProject().checker.getSymbolAtLocation(calls.map(({ call }) => call.expression));
		const edits: { start: number; end: number; text: string }[] = [];
		for (const [index, { argument }] of calls.entries()) {
			const symbol = symbols[index];
			// A local declaration owns this call's arguments, including hoisted and destructured bindings.
			if (symbol?.declarations.length) continue;
			// Keep Node's require conditions, extension probing and lazy loading.
			edits.push({ start: argument.getStart(file), end: argument.end, text: JSON.stringify(resolve(dirname(path), argument.text)) });
		}
		let rewritten = source;
		for (const edit of edits.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
		return rewritten;
	} finally { await snapshot.dispose(); }
}
