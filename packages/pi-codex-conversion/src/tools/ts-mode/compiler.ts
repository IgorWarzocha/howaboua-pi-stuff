import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { API, RawCompilerOptions, Diagnostic, ModuleResolver, Snapshot, SyntheticProjectId } from 'tsrs/async';
import type { Node } from 'tsrs/ast';
import { applyEdits, compilerAst } from './compiler-ast.js';
import { startTsCompiler, type TsCompilerProcess } from './compiler-process.ts';
import type { TsRuntime } from './runtime.ts';
import type { TsBinding, TsCompileInput, TsCompileResult, TsDiagnostic, TsImportReference } from './compiler-contract.js';
export type { TsBinding, TsCompileInput, TsCompileResult, TsImportReference } from './compiler-contract.js';

function diagnostic(value: Diagnostic, fileName: string, prefixLines: number): TsDiagnostic {
  const lineOffset = value.fileName === fileName && value.startPosition && value.startPosition.line >= prefixLines ? prefixLines : 0;
  return {
    code: value.code, message: value.text,
    ...(value.fileName ? { file: value.fileName } : {}),
    ...(value.startPosition ? { line: value.startPosition.line + 1 - lineOffset, column: value.startPosition.character + 1 } : {}),
  };
}

/** One persistent compiler child per session; execution workers never own it. */
export class TsCompiler {
  private readonly runtime: TsRuntime;
  private readonly syntax: ReturnType<typeof compilerAst>;
  private readonly process: Promise<TsCompilerProcess>;
  private readonly fileName: string;
  private readonly options: RawCompilerOptions;
  private snapshot: Snapshot | undefined;
  private snapshotHasDependencies = false;
  private globals: { declaration: string; source: string; prefix: string } | undefined;
  private snapshotGlobals: string | undefined;
  private resolver: { mappings: ReadonlyMap<string, string>; moduleResolver: ModuleResolver } | undefined;
  private programId: SyntheticProjectId | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(runtime: TsRuntime, options: { cwd: string; tsserverPath?: string }) {
    this.runtime = runtime;
    this.syntax = compilerAst(runtime);
    this.process = startTsCompiler(runtime, options);
    this.fileName = join(options.cwd, '__pi_ts_cell.mts');
    this.options = {
      target: runtime.ast.ScriptTarget.ESNext,
      module: runtime.api.ModuleKind.ESNext,
      moduleResolution: runtime.api.ModuleResolutionKind.Bundler,
      strict: true, skipLibCheck: true, declaration: true, preserveConstEnums: true,
      resolveJsonModule: true, types: ['node'], typeRoots: runtime.typeRoots,
    };
  }

  compile(input: TsCompileInput): Promise<TsCompileResult> {
    return this.withApi(() => this.compileCell(input));
  }

  /** Import graph compilation borrows this owner; it must not close the API. */
  withApi<T>(operation: (api: API, runtime: TsRuntime) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('TypeScript session is closed.'));
    const result = this.queue.then(async () => operation((await this.process).api, this.runtime));
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  async scanImports(source: string): Promise<string[]> {
    return [...new Set((await this.scanImportReferences(source)).map(reference => reference.specifier))];
  }

  scanImportReferences(source: string): Promise<TsImportReference[]> {
    if (this.closed) return Promise.reject(new Error('TypeScript session is closed.'));
    const result = this.queue.then(async () => {
      const { api } = await this.process;
      const lease = await api.createSourceFile(this.fileName, source);
      try {
        const references: TsImportReference[] = [];
        const add = (node: Node): void => {
          if (this.runtime.ast.isStringLiteral(node)) references.push({ specifier: node.text, start: node.getStart(lease.sourceFile), end: node.end });
        };
        const walk = (node: Node): void => {
          if (this.runtime.ast.isImportDeclaration(node)) add(node.moduleSpecifier);
          if (this.runtime.ast.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier);
          if (this.runtime.ast.isImportTypeNode(node) && this.runtime.ast.isLiteralTypeNode(node.argument)) add(node.argument.literal);
          if (this.runtime.ast.isCallExpression(node) && node.expression.kind === this.runtime.ast.SyntaxKind.ImportKeyword) {
            const first = node.arguments?.[0];
            if (first) add(first);
          }
          node.forEachChild(walk);
        };
        walk(lease.sourceFile);
        return references;
      } finally { await lease.dispose(); }
    });
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    try { await this.snapshot?.dispose(); }
    finally {
      try { await this.resolver?.moduleResolver.dispose(); }
      finally { await (await this.process).close(); }
    }
  }

  private async compileCell(input: TsCompileInput): Promise<TsCompileResult> {
    const { api } = await this.process;
    // A checked module reuses toolkit types without leaking them into user imports.
    // Keep .mts: skipLibCheck would suppress errors in a declaration-only file.
    const globalsFile = join(dirname(this.fileName), '__pi_ts_globals.mts');
    const globalsDeclaration = input.globalsDeclaration ?? '';
    if (this.globals?.declaration !== globalsDeclaration) {
      const lease = await api.createSourceFile(globalsFile, globalsDeclaration);
      try {
        const names = [...new Set(this.syntax.inventory(lease.sourceFile).map(binding => binding.name))];
        this.globals = { declaration: globalsDeclaration,
          source: `${globalsDeclaration}\nexport { ${names.join(', ')} };`,
          prefix: names.length ? `import { ${names.join(', ')} } from "./__pi_ts_globals.mjs";\n` : '' };
      } finally { await lease.dispose(); }
    }
    const globals = this.globals;
    const prefix = `${globals.prefix}${input.baselineDeclarations}\n`;
    const prefixLines = prefix.split('\n').length - 1;
    const report = (value: Diagnostic): TsDiagnostic => diagnostic(value, this.fileName, prefixLines);
    const lease = await api.createSourceFile(this.fileName, prefix + input.source);
    let names: string[];
    let exportNames: string[];
    let hasDependencies = Boolean(input.moduleResolutions?.size);
    let strictDirective = false;
    try {
      const inventory = this.syntax.inventory(lease.sourceFile, prefix.length);
      names = [...new Set(inventory.map(binding => binding.name))];
      const file = lease.sourceFile;
      for (const node of file.statements.filter(node => node.getStart(file) >= prefix.length)) {
        if (!this.runtime.ast.isExpressionStatement(node) || !this.runtime.ast.isStringLiteral(node.expression)) break;
        if (/^(['"])use strict\1$/.test(node.expression.getText(file))) strictDirective = true;
      }
      const exported = new Set<string>();
      for (const statement of file.statements) {
        if (this.runtime.ast.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && this.runtime.ast.isNamedExports(statement.exportClause)) {
          for (const item of statement.exportClause.elements) exported.add(item.name.text);
        } else if (this.syntax.modifiers(statement).some(modifier => modifier.kind === this.runtime.ast.SyntaxKind.ExportKeyword) && !this.syntax.modifiers(statement).some(modifier => modifier.kind === this.runtime.ast.SyntaxKind.DefaultKeyword)) {
          for (const binding of inventory) if (binding.node.pos >= statement.pos && binding.node.end <= statement.end) exported.add(binding.name);
        }
      }
      exportNames = names.filter(name => !exported.has(name));
      hasDependencies ||= Boolean(file.referencedFiles.length || file.typeReferenceDirectives.length || file.libReferenceDirectives.length);
      let unsupportedMeta = false;
      const walk = (node: Node, parent?: Node): void => {
        // The virtual toolkit import is owned here, not a disk dependency.
        if (node !== file && node.getStart(file) < globals.prefix.length) return;
        if (this.runtime.ast.isMetaProperty(node) && node.keywordToken === this.runtime.ast.SyntaxKind.ImportKeyword &&
          !(parent && this.runtime.ast.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'url')) unsupportedMeta = true;
        if (this.runtime.ast.isImportDeclaration(node) || this.runtime.ast.isImportTypeNode(node) || node.kind === this.runtime.ast.SyntaxKind.ImportEqualsDeclaration ||
          (this.runtime.ast.isExportDeclaration(node) && node.moduleSpecifier) ||
          (this.runtime.ast.isCallExpression(node) && node.expression.kind === this.runtime.ast.SyntaxKind.ImportKeyword)) hasDependencies = true;
        node.forEachChild(child => walk(child, node));
      };
      walk(file);
      if (unsupportedMeta) return { ok: false, diagnostics: [{ code: 0, message: 'Only import.meta.url is available in notebook cells. Use other import.meta APIs inside an imported module.' }] };
    }
    finally { await lease.dispose(); }
    if (names.some(name => name === '__tsImport' || name === '__tsRegisterRecipe')) return {
      ok: false, diagnostics: [{ code: 0, message: 'Names __tsImport and __tsRegisterRecipe are reserved. Choose another binding name.' }],
    };
    const source = prefix + input.source + `\nexport { ${exportNames.join(', ')} };\n`;
    const mappings = new Map(input.moduleResolutions);
    const previousResolver = this.resolver;
    // Native static entries preserve the old name-only override and native fallback,
    // without sending the entire Node type graph through callback RPCs each cell.
    const resolver = previousResolver && mappings.size === previousResolver.mappings.size &&
      [...mappings].every(([name, path]) => previousResolver.mappings.get(name) === path)
      ? previousResolver : mappings.size ? {
        mappings,
        moduleResolver: await api.createModuleResolver(this.options, {
          moduleResolutions: { fallback: 'resolve', entries: [...mappings].map(([moduleName, resolvedFileName]) => ({ moduleName, result: { resolvedFileName } })) },
        }),
      } : undefined;
    const moduleResolver = resolver?.moduleResolver;
    try {
      const old = this.snapshot;
      // Disk imports need a full refresh, including when leaving their graph.
      // A fresh program avoids updating a graph whose caches are discarded anyway.
      const refresh = hasDependencies || this.snapshotHasDependencies;
      const next = old && this.programId && !refresh ? await old.update({
        fileSystem: this.runtime.fs.createFileSystemLayer([[this.fileName, source], [globalsFile, globals.source]]),
        fileNotifications: { changed: [this.fileName, ...(this.snapshotGlobals !== globals.source ? [globalsFile] : [])] },
        reconfigurePrograms: [{ id: this.programId, rootFiles: [this.fileName], compilerOptions: this.options, options: { moduleResolver } }],
      }) : await api.createSnapshot({
        fileSystem: this.runtime.fs.createFileSystemLayer([[this.fileName, source], [globalsFile, globals.source]]),
        fileNotifications: { invalidateAll: refresh },
        createPrograms: [{ rootFiles: [this.fileName], compilerOptions: this.options, options: { moduleResolver } }],
      });
      this.snapshot = next;
      this.snapshotGlobals = globals.source;
      this.snapshotHasDependencies = hasDependencies;
      this.resolver = resolver;
      await old?.dispose();
      if (previousResolver !== resolver) await previousResolver?.moduleResolver.dispose();
      const program = next.operation.createdPrograms?.[0] ?? (this.programId ? next.getProgram(this.programId) : undefined);
      if (!program) throw new Error('TypeScript could not prepare the cell.');
      this.programId = program.getProject().id;
      const errors = [
        ...await program.getSyntacticDiagnostics(),
        ...await program.getSemanticDiagnostics(),
        ...await program.getGlobalDiagnostics(),
      ].filter(value => value.category === 1);
      if (errors.length) return { ok: false, diagnostics: errors.map(report) };
      const file = await program.getSourceFile(this.fileName);
      if (!file) throw new Error('TypeScript could not read the cell.');
      const nodes = [...new Map(this.syntax.inventory(file, prefix.length).map(binding => [binding.name, binding])).values()];
      const emitted = await program.getJavaScriptEmit([this.fileName]);
      const declarations = await program.getDeclarationEmit([this.fileName]);
      const emissionErrors = [...emitted.diagnostics, ...declarations.diagnostics].filter(value => value.category === 1);
      if (emissionErrors.length) return { ok: false, diagnostics: emissionErrors.map(report) };
      const javascript = [...emitted.outputFiles].find(([name]) => /\.m?js$/.test(name))?.[1].text;
      const declarationText = [...declarations.outputFiles].find(([name]) => /\.d\.m?ts$/.test(name))?.[1].text;
      if (javascript === undefined || declarationText === undefined) throw new Error('TypeScript did not emit the cell.');
      const checker = program.getProject().checker;
      const bindings: TsBinding[] = [];
      for (const binding of nodes) {
        const symbol = await checker.resolveName(binding.name, this.runtime.api.SymbolFlags.Value | this.runtime.api.SymbolFlags.Alias, binding.node);
        const type = binding.kind === 'type' ? binding.name : await checker.typeToString(symbol ? await checker.getTypeOfSymbol(symbol) : await checker.getTypeAtLocation(binding.node), binding.node, this.runtime.api.TypeFormatFlags.NoTruncation | this.runtime.api.TypeFormatFlags.UseFullyQualifiedType);
        let declaration = await this.bindingDeclaration(binding.name, binding.kind, type, declarationText);
        if (this.runtime.ast.isImportDeclaration(binding.node)) {
          const recipe = this.syntax.importRecipe(binding.node);
          const imported = recipe?.bindings.find(value => value.local === binding.name);
          if (recipe && imported) {
            const clause = imported.imported === '*' ? `* as ${binding.name}` : imported.imported === 'default' ? binding.name : `{ ${imported.imported} as ${binding.name} }`;
            const attributes = binding.kind !== 'type' && recipe.attributes ? ` with ${JSON.stringify(recipe.attributes)}` : '';
            declaration = `import${binding.kind === 'type' ? ' type' : ''} ${clause} from ${JSON.stringify(recipe.specifier)}${attributes};`;
          }
        }
        bindings.push({ name: binding.name, kind: binding.kind, type, declaration,
          freeReferences: await this.syntax.freeReferences(binding.functionNode ?? binding.node, checker, !binding.functionNode && binding.kind !== 'type'),
        });
      }
      const transformed = await this.executable(javascript, bindings, input.mode !== 'live', strictDirective);
      return { ok: true, javascript: transformed, declarations: bindings.map(binding => binding.declaration).join('\n'), bindings,
        imports: file.statements.filter(node => node.getStart(file) >= prefix.length).flatMap(node => { const recipe = this.syntax.importRecipe(node); return recipe ? [recipe] : []; }),
      };
    } finally {
      // Failed snapshot creation still owns its unadopted resolver generation.
      if (this.resolver !== resolver) await resolver?.moduleResolver.dispose();
    }
  }

  private async bindingDeclaration(name: string, kind: TsBinding['kind'], type: string, source: string): Promise<string> {
    const lease = await (await this.process).api.createSourceFile(this.fileName.replace('.mts', '.d.mts'), source);
    try {
      const declarations = this.syntax.inventory(lease.sourceFile).filter(binding => binding.name === name).map(binding => {
        if (this.runtime.ast.isVariableDeclaration(binding.node) && !this.runtime.ast.isIdentifier(binding.node.name))
          return `declare ${binding.kind} ${name}: ${type};`;
        const text = binding.node.getText(lease.sourceFile).replace(/^export\s+(?:default\s+)?/, '');
        if ((kind === 'function' || kind === 'class') && !text.startsWith('declare ')) return `declare ${text}`;
        return binding.kind === 'const' || binding.kind === 'let' ? `declare ${binding.kind} ${text};` : text;
      });
      return declarations.join('\n') || `declare ${kind === 'let' ? 'let' : 'const'} ${name}: ${type};`;
    } finally { await lease.dispose(); }
  }

  private async executable(source: string, bindings: TsBinding[], strictContext: boolean, strictDirective: boolean): Promise<string> {
    const lease = await (await this.process).api.createSourceFile(this.fileName.replace('.mts', '.mjs'), source);
    try {
      const file = lease.sourceFile;
      const edits: { start: number; end: number; text: string }[] = [];
      const imports: string[] = [];
      for (const node of file.statements) {
        if (this.runtime.ast.isExportDeclaration(node)) edits.push({ start: node.getStart(file), end: node.end, text: '' });
        else if (this.runtime.ast.isExportAssignment(node)) {
          edits.push({ start: node.getStart(file), end: node.expression.getStart(file), text: '(' });
          edits.push({ start: node.expression.end, end: node.end, text: ');' });
        }
        else if (this.runtime.ast.isImportDeclaration(node)) {
          const recipe = this.syntax.importRecipe(node);
          if (!recipe) throw new Error('Unsupported TypeScript import.');
          const target = JSON.stringify(recipe.specifier);
          const importExpression = `await __tsImport(${target}${recipe.attributes ? `, ${JSON.stringify({ with: recipe.attributes })}` : ''})`;
          // Baseline imports retain type/namespace authority but their values are restored by the worker.
          const lines = recipe.bindings.filter(binding => !binding.typeOnly && bindings.some(candidate => candidate.name === binding.local)).map(binding => `const ${binding.local} = (${importExpression})${binding.imported === '*' ? '' : `[${JSON.stringify(binding.imported)}]`};`);
          if (lines.length) imports.push(lines.join('\n'));
          else if (!recipe.bindings.length) imports.push(`${importExpression};`);
          edits.push({ start: node.getStart(file), end: node.end, text: '' });
        } else {
          const anonymous = (this.runtime.ast.isFunctionDeclaration(node) || this.runtime.ast.isClassDeclaration(node)) && !node.name;
          for (const modifier of this.syntax.modifiers(node)) {
            if (modifier.kind === this.runtime.ast.SyntaxKind.ExportKeyword || modifier.kind === this.runtime.ast.SyntaxKind.DefaultKeyword) edits.push({ start: modifier.getStart(file), end: modifier.end, text: anonymous && modifier.kind === this.runtime.ast.SyntaxKind.ExportKeyword ? '(' : '' });
          }
          if (anonymous) edits.push({ start: node.end, end: node.end, text: ');' });
        }
      }
      const walk = (node: Node): void => {
        if (this.runtime.ast.isPropertyAccessExpression(node) && this.runtime.ast.isMetaProperty(node.expression) && node.expression.keywordToken === this.runtime.ast.SyntaxKind.ImportKeyword && node.name.text === 'url') {
          edits.push({ start: node.getStart(file), end: node.end, text: JSON.stringify(pathToFileURL(this.fileName).href) });
        }
        if (this.runtime.ast.isCallExpression(node) && node.expression.kind === this.runtime.ast.SyntaxKind.ImportKeyword) edits.push({ start: node.expression.getStart(file), end: node.expression.end, text: '__tsImport' });
        node.forEachChild(walk);
      };
      walk(file);
      const registrations: string[] = [];
      // Register only direct top-level functions, never closures returned by calls.
      // Registration preserves the original live function and its lexical environment.
      for (const node of this.syntax.inventory(file)) {
        const binding = bindings.find(value => value.name === node.name);
        if (!binding || !node.functionNode) continue;
        const functionNode = node.functionNode;
        const functionStart = functionNode.getStart(file);
        const functionEdits = edits.filter(edit => edit.start >= functionStart && edit.end <= functionNode.getEnd()).map(edit => ({ ...edit, start: edit.start - functionStart, end: edit.end - functionStart }));
        // Declarations recurse through their mutable outer binding, unlike named expressions.
        if (this.runtime.ast.isFunctionDeclaration(functionNode) && functionNode.name) functionEdits.push({ start: functionNode.name.getStart(file) - functionStart, end: functionNode.name.end - functionStart, text: '' });
        const text = applyEdits(functionNode.getText(file), functionEdits).replace(/^export\s+/, '');
        // Encode creation strictness without adding a scope around the live lexical bindings.
        binding.source = strictContext || strictDirective ? `(() => { "use strict"; return (${text}); })()` : `(${text})`;
        if (this.runtime.ast.isFunctionDeclaration(functionNode)) registrations.push(`__tsRegisterRecipe(${JSON.stringify(binding.name)}, ${binding.name});`);
        else {
          edits.push({ start: functionStart, end: functionStart, text: `__tsRegisterRecipe(${JSON.stringify(binding.name)}, (` });
          edits.push({ start: functionNode.end, end: functionNode.end, text: '))' });
        }
      }
      // Hoisted registrations/import bridges must not displace the user's directive prologue.
      return [strictDirective ? '"use strict";' : '', ...imports, ...registrations].join('\n') + '\n' + applyEdits(source, edits).replace(/^\/\/# sourceMappingURL=.*$/m, '');
    } finally { await lease.dispose(); }
  }
}
