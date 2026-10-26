import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../code-mode/custom-tool-prompt.ts";
import { commandOutputFormatterSource } from "../code-mode/command-output.ts";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";
import type { CodeModeToolDefinition } from "../code-mode/types.ts";
import type { NotebookRuntimeOptions } from "../code-mode/shared-runtime.ts";
import { TsCompiler } from "./compiler.ts";
import { loadTsRuntime, type TsRuntime } from "./runtime.ts";
import { resolveTsImports, resolveTsRuntimeImport, type TsImportOptions } from "./imports.ts";
import type { BindingRecipe, PortableState } from "./portable-state.ts";
import { buildTsToolDeclarations } from "./tool-declarations.ts";
import { TS_GLOBAL_DECLARATIONS, type TsWorkerInput } from "./worker-protocol.ts";

/** Session compiler and import authority; resetting the heap does not close the compiler. */
export class TsSessionCompilation {
	private readonly options: NotebookRuntimeOptions;
	private readonly importOptions: TsImportOptions;
	private readonly liveSourceModules = new Map<string, string>();
	private compiler: TsCompiler | undefined;
	private runtime: TsRuntime | undefined;

	constructor(options: NotebookRuntimeOptions) {
		this.options = options;
		this.importOptions = { cwd: process.cwd(), agentDir: options.agentDir, cacheDir: join(options.agentDir, "ts-imports"), sourceModules: this.liveSourceModules };
	}

	get cwd(): string { return this.importOptions.cwd; }

	beginSession(cwd: string): void {
		this.importOptions.cwd = cwd;
		this.importOptions.sourceDir = join(this.importOptions.cacheDir, "sessions", randomUUID());
	}
	clearSourceModules(): void { this.liveSourceModules.clear(); }
	async closeCompiler(): Promise<void> { const compiler = this.compiler; this.compiler = undefined; await compiler?.close(); }
	async removeSessionSources(): Promise<void> {
		if (this.importOptions.sourceDir) await rm(this.importOptions.sourceDir, { recursive: true, force: true });
		delete this.importOptions.sourceDir;
	}
	executionImports(isolated: boolean, signal: AbortSignal, usedImports: Set<string>): TsImportOptions {
		return { ...this.importOptions, ...(this.compiler ? { compiler: this.compiler } : {}), signal, sourceModules: isolated ? new Map() : this.liveSourceModules, onNpmImport: specifier => usedImports.add(specifier) };
	}
	async resolveImport(name: string): Promise<string> {
		return resolveTsRuntimeImport(name, { ...this.importOptions, compiler: await this.requireCompiler() });
	}

	async compile(source: string, start: PortableState, isolated: boolean, importsOptions: TsImportOptions, tools: CodeModeToolDefinition[], signal: AbortSignal): Promise<TsWorkerInput> {
		const compiler = await this.requireCompiler(signal);
		importsOptions.compiler = compiler;
		const baselineDeclarations = Object.values(start.bindings).map(binding => binding.declaration).join("\n");
		const imports = await resolveTsImports(await this.scanImports(compiler, `${baselineDeclarations}\n${source}`), importsOptions);
		signal.throwIfAborted();
		const compiled = await compiler.compile({ source, mode: isolated ? "isolated" : "live", baselineDeclarations, globalsDeclaration: `${TS_GLOBAL_DECLARATIONS}\n${buildTsToolDeclarations(tools)}`, ...imports }).catch(error => { throw this.compilerFailure(error); });
		if (!compiled.ok) throw new Error(compiled.diagnostics.map(diagnostic => `TS${diagnostic.code}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""} ${diagnostic.message}`).join("\n"));
		signal.throwIfAborted();
		const bindings: Record<string, BindingRecipe> = { ...start.bindings };
		for (const binding of compiled.bindings) {
			if (binding.name.startsWith("__") || ["tools", "text", "image", "generatedImage", "notify", "store", "load", "ALL_TOOLS", "exit", "yield_control"].includes(binding.name)) throw new Error(`TS binding ${binding.name} is reserved; choose another name`);
			if (Object.hasOwn(start.bindings, binding.name)) throw new Error(`TS binding ${binding.name} already exists; assign to a let binding, or release it before declaring it again`);
			if (isolated && (binding.kind === "class" || binding.kind === "namespace")) throw new Error(`${binding.name}: ${binding.kind} bindings cannot transfer from isolated execution; use a normal live cell`);
			bindings[binding.name] = { name: binding.name, kind: binding.kind, declaration: binding.declaration, references: binding.freeReferences, ...(binding.source ? { source: binding.source } : {}) };
		}
		for (const imported of compiled.imports) if (!imported.typeOnly) for (const binding of imported.bindings) {
			if (binding.typeOnly) continue;
			const recipe = bindings[binding.local];
			if (recipe) recipe.module = { specifier: imported.specifier, imported: binding.imported, ...(imported.attributes ? { attributes: imported.attributes } : {}) };
		}
		return { ...this.workerInput(start, bindings, tools), mode: isolated ? "isolated" : "live", javascript: compiled.javascript };
	}
	workerInput(state: PortableState, bindings: Record<string, BindingRecipe>, tools: CodeModeToolDefinition[]): TsWorkerInput {
		return { mode: "live", state, javascript: "", bindings,
			toolNames: Object.fromEntries(tools.map(tool => [codeModeGlobalName(tool.name), tool.name])),
			toolMetadata: tools.filter(isCodeModeToolDiscoverable).map(tool => ({ name: codeModeGlobalName(tool.name), description: formatCodeModeToolHelp(tool) })),
			outputHints: Object.fromEntries(tools.flatMap(tool => "textOutput" in tool && tool.textOutput ? [[tool.name, tool.textOutput]] : [])),
			commandFormatter: commandOutputFormatterSource, maxStateBytes: this.options.maxHeapMiB * 1024 * 1024 / 8 };
	}
	private async requireCompiler(signal?: AbortSignal): Promise<TsCompiler> {
		const runtime = this.runtime ?? await loadTsRuntime(this.options.agentDir, signal);
		signal?.throwIfAborted();
		this.runtime = runtime;
		try { this.compiler ??= new TsCompiler(runtime, { cwd: this.importOptions.cwd }); }
		catch (cause) { throw this.compilerFailure(cause); }
		return this.compiler;
	}
	private compilerFailure(cause: unknown): Error { return new Error("The TS compiler is unavailable. Try notebook restart; check that this platform supports TS and npm includes optional dependencies. Code and Deno Notebook remain available.", { cause }); }
	private async scanImports(compiler: TsCompiler, source: string): Promise<string[]> {
		try { return await compiler.scanImports(source); }
		catch (error) { throw this.compilerFailure(error); }
	}
	async validateCheckpoint(state: PortableState, name: string, checkpoint: NonNullable<BindingRecipe["checkpoint"]>): Promise<void> {
		for (const helper of [checkpoint.snapshot, checkpoint.restore]) {
			const binding = state.bindings[helper];
			if (!binding?.source && !binding?.module) throw new Error(`TS checkpoint helper ${helper} must be a named portable top-level function or import`);
			if (helper === name) throw new Error("TS checkpoint helpers must differ from the registered binding");
		}
		const compiler = await this.requireCompiler();
		const baselineDeclarations = Object.values(state.bindings).map(binding => binding.declaration).join("\n");
		const imports = await resolveTsImports(await this.scanImports(compiler, baselineDeclarations), { ...this.importOptions, compiler });
		const result = await compiler.compile({ source: `const __checkpointData = await ${checkpoint.snapshot}(${name}); const __checkpointValue: typeof ${name} = await ${checkpoint.restore}(__checkpointData);`, baselineDeclarations, globalsDeclaration: TS_GLOBAL_DECLARATIONS + "\ndeclare const tools: Record<string, unknown>;", ...imports });
		if (!result.ok) throw new Error(`TS checkpoint helpers are incompatible: ${result.diagnostics.map(diagnostic => `TS${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
	}
	async validateDeclarations(state: PortableState): Promise<void> {
		const baselineDeclarations = Object.values(state.bindings).map(binding => binding.declaration).join("\n");
		if (!baselineDeclarations) return;
		const compiler = await this.requireCompiler();
		const imports = await resolveTsImports(await this.scanImports(compiler, baselineDeclarations), { ...this.importOptions, compiler });
		const result = await compiler.compile({ source: "", baselineDeclarations, globalsDeclaration: TS_GLOBAL_DECLARATIONS + "\ndeclare const tools: Record<string, unknown>;", ...imports });
		if (!result.ok) throw new Error(`TS declarations would become invalid; retain their type dependencies or release dependent bindings together: ${result.diagnostics.map(diagnostic => `TS${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
	}
}
