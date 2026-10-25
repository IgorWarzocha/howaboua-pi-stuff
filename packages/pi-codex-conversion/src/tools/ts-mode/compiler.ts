import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { API, ModuleKind, ModuleResolutionKind, SymbolFlags, TypeFormatFlags, type CompilerOptions, type Diagnostic, type Snapshot, type SyntheticProjectId } from 'tsrs/unstable/async';
import { createFileSystemLayer } from 'tsrs/unstable/fs';
import {
  isExportDeclaration, isCallExpression, isImportDeclaration, isFunctionDeclaration,
  isStringLiteral, isImportTypeNode, isLiteralTypeNode, isMetaProperty, isPropertyAccessExpression, SyntaxKind, ScriptTarget, type Node,
} from 'tsrs/unstable/ast';
import { applyEdits, freeReferences, importRecipe, inventory } from './compiler-ast.js';
import type { TsBinding, TsCompileInput, TsCompileResult, TsDiagnostic, TsImportReference } from './compiler-contract.js';
export type { TsBinding, TsCompileInput, TsCompileResult, TsImportReference } from './compiler-contract.js';

const compilerOptions: CompilerOptions = {
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  declaration: true,
  sourceMap: true,
  inlineSources: true,
  preserveConstEnums: true,
  resolveJsonModule: true,
  types: ['node'],
};

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
  private readonly api: API;
  private readonly fileName: string;
  private readonly options: CompilerOptions;
  private snapshot: Snapshot | undefined;
  private programId: SyntheticProjectId | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: { cwd: string; tsserverPath?: string }) {
    this.api = new API({ cwd: options.cwd, ...(options.tsserverPath ? { tsserverPath: options.tsserverPath } : {}) });
    this.fileName = join(options.cwd, '__pi_ts_cell.mts');
    this.options = { ...compilerOptions, typeRoots: [dirname(dirname(createRequire(import.meta.url).resolve('@types/node/package.json')))] };
  }

  compile(input: TsCompileInput): Promise<TsCompileResult> {
    return this.withApi(() => this.compileCell(input));
  }

  /** Import graph compilation borrows this owner; it must not close the API. */
  withApi<T>(operation: (api: API) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('TypeScript session is closed.'));
    const result = this.queue.then(() => operation(this.api));
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  async scanImports(source: string): Promise<string[]> {
    return [...new Set((await this.scanImportReferences(source)).map(reference => reference.specifier))];
  }

  scanImportReferences(source: string): Promise<TsImportReference[]> {
    if (this.closed) return Promise.reject(new Error('TypeScript session is closed.'));
    const result = this.queue.then(async () => {
      const lease = await this.api.createSourceFile(this.fileName, source);
      try {
        const references: TsImportReference[] = [];
        const add = (node: Node): void => {
          if (isStringLiteral(node)) references.push({ specifier: node.text, start: node.getStart(lease.sourceFile), end: node.end });
        };
        const walk = (node: Node): void => {
          if (isImportDeclaration(node)) add(node.moduleSpecifier);
          if (isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier);
          if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) add(node.argument.literal);
          if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
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
    finally { await this.api.close(); }
  }

  private async compileCell(input: TsCompileInput): Promise<TsCompileResult> {
    const prefix = `${input.globalsDeclaration ?? ''}\n${input.baselineDeclarations}\n`;
    const prefixLines = prefix.split('\n').length - 1;
    const report = (value: Diagnostic): TsDiagnostic => diagnostic(value, this.fileName, prefixLines);
    const lease = await this.api.createSourceFile(this.fileName, prefix + input.source);
    let names: string[];
    try { names = [...new Set(inventory(lease.sourceFile, prefix.length).map(binding => binding.name))]; }
    finally { await lease.dispose(); }
    if (names.some(name => name === '__tsImport' || name === '__tsRegisterRecipe')) return {
      ok: false, diagnostics: [{ code: 0, message: 'Names __tsImport and __tsRegisterRecipe are reserved. Choose another binding name.' }],
    };
    const source = prefix + input.source + `\nexport { ${names.join(', ')} };\n`;
    const nativeResolver = await this.api.createModuleResolver(this.options);
    const moduleResolver = await this.api.createModuleResolver(this.options, {
      resolveModuleName: async (name, containingDirectory, resolutionMode, options) => {
        const resolvedFileName = input.moduleResolutions?.get(name);
        if (resolvedFileName) return { resolvedFileName };
        return (await nativeResolver.resolveModuleName(name, containingDirectory, resolutionMode, options)).resolvedModule;
      },
    });
    try {
      const old = this.snapshot;
      const next = old && this.programId ? await old.update({
        fileSystem: createFileSystemLayer([[this.fileName, source]]),
        fileNotifications: { changed: [this.fileName] },
        reconfigurePrograms: [{ id: this.programId, rootFiles: [this.fileName], compilerOptions: this.options, options: { moduleResolver } }],
      }) : await this.api.createSnapshot({
        fileSystem: createFileSystemLayer([[this.fileName, source]]),
        createPrograms: [{ rootFiles: [this.fileName], compilerOptions: this.options, options: { moduleResolver } }],
      });
      this.snapshot = next;
      await old?.dispose();
      const program = this.programId ? next.getProgram(this.programId) : next.operation.createdPrograms?.[0];
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
      const nodes = [...new Map(inventory(file, prefix.length).map(binding => [binding.name, binding])).values()];
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
        const symbol = await checker.resolveName(binding.name, SymbolFlags.Value | SymbolFlags.Alias, binding.node);
        const type = binding.kind === 'type' ? binding.name : await checker.typeToString(symbol ? await checker.getTypeOfSymbol(symbol) : await checker.getTypeAtLocation(binding.node), undefined, TypeFormatFlags.NoTruncation);
        let declaration = await this.bindingDeclaration(binding.name, binding.kind, type, declarationText);
        if (isImportDeclaration(binding.node)) {
          const recipe = importRecipe(binding.node);
          const imported = recipe?.bindings.find(value => value.local === binding.name);
          if (recipe && imported) {
            const clause = imported.imported === '*' ? `* as ${binding.name}` : imported.imported === 'default' ? binding.name : `{ ${imported.imported} as ${binding.name} }`;
            const attributes = binding.kind !== 'type' && recipe.attributes ? ` with ${JSON.stringify(recipe.attributes)}` : '';
            declaration = `import${binding.kind === 'type' ? ' type' : ''} ${clause} from ${JSON.stringify(recipe.specifier)}${attributes};`;
          }
        }
        bindings.push({ name: binding.name, kind: binding.kind, type, declaration,
          freeReferences: await freeReferences(binding.functionNode ?? binding.node, checker, !binding.functionNode && binding.kind !== 'type'),
        });
      }
      const transformed = await this.executable(javascript, bindings);
      return { ok: true, javascript: transformed, declarations: bindings.map(binding => binding.declaration).join('\n'), bindings,
        imports: file.statements.filter(node => node.getStart(file) >= prefix.length).flatMap(node => { const recipe = importRecipe(node); return recipe ? [recipe] : []; }),
      };
    } finally {
      try { await moduleResolver.dispose(); }
      finally { await nativeResolver.dispose(); }
    }
  }

  private async bindingDeclaration(name: string, kind: TsBinding['kind'], type: string, source: string): Promise<string> {
    const lease = await this.api.createSourceFile(this.fileName.replace('.mts', '.d.mts'), source);
    try {
      const declarations = inventory(lease.sourceFile).filter(binding => binding.name === name).map(binding => {
        const text = binding.node.getText(lease.sourceFile).replace(/^export\s+/, '');
        return binding.kind === 'const' || binding.kind === 'let' ? `declare ${binding.kind} ${text};` : text;
      });
      return declarations.join('\n') || `declare ${kind === 'let' ? 'let' : 'const'} ${name}: ${type};`;
    } finally { await lease.dispose(); }
  }

  private async executable(source: string, bindings: TsBinding[]): Promise<string> {
    const lease = await this.api.createSourceFile(this.fileName.replace('.mts', '.mjs'), source);
    try {
      const file = lease.sourceFile;
      const edits: { start: number; end: number; text: string }[] = [];
      const imports: string[] = [];
      for (const node of file.statements) {
        if (isExportDeclaration(node)) edits.push({ start: node.getStart(file), end: node.end, text: '' });
        else if (isImportDeclaration(node)) {
          const recipe = importRecipe(node);
          if (!recipe) throw new Error('Unsupported TypeScript import.');
          const target = JSON.stringify(recipe.specifier);
          const importExpression = `await __tsImport(${target}${recipe.attributes ? `, ${JSON.stringify({ with: recipe.attributes })}` : ''})`;
          // Baseline imports retain type/namespace authority but their values are restored by the worker.
          const lines = recipe.bindings.filter(binding => !binding.typeOnly && bindings.some(candidate => candidate.name === binding.local)).map(binding => `const ${binding.local} = (${importExpression})${binding.imported === '*' ? '' : `[${JSON.stringify(binding.imported)}]`};`);
          if (lines.length) imports.push(lines.join('\n'));
          else if (!recipe.bindings.length) imports.push(`${importExpression};`);
          edits.push({ start: node.getStart(file), end: node.end, text: '' });
        } else {
          for (const child of node.getChildren(file)) {
            if (child.kind === SyntaxKind.ExportKeyword || child.kind === SyntaxKind.DefaultKeyword) edits.push({ start: child.getStart(file), end: child.end, text: '' });
          }
        }
      }
      const walk = (node: Node): void => {
        if (isPropertyAccessExpression(node) && isMetaProperty(node.expression) && node.expression.keywordToken === SyntaxKind.ImportKeyword && node.name.text === 'url') {
          edits.push({ start: node.getStart(file), end: node.end, text: JSON.stringify(pathToFileURL(this.fileName).href) });
        }
        if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) edits.push({ start: node.expression.getStart(file), end: node.expression.end, text: '__tsImport' });
        node.forEachChild(walk);
      };
      walk(file);
      const registrations: string[] = [];
      // Register only direct top-level functions, never closures returned by calls.
      // Registration preserves the original live function and its lexical environment.
      for (const node of inventory(file)) {
        const binding = bindings.find(value => value.name === node.name);
        if (!binding || !node.functionNode) continue;
        const functionNode = node.functionNode;
        const functionStart = functionNode.getStart(file);
        const functionEdits = edits.filter(edit => edit.start >= functionStart && edit.end <= functionNode.getEnd()).map(edit => ({ ...edit, start: edit.start - functionStart, end: edit.end - functionStart }));
        // Declarations recurse through their mutable outer binding, unlike named expressions.
        if (isFunctionDeclaration(functionNode) && functionNode.name) functionEdits.push({ start: functionNode.name.getStart(file) - functionStart, end: functionNode.name.end - functionStart, text: '' });
        const text = applyEdits(functionNode.getText(file), functionEdits).replace(/^export\s+/, '');
        binding.source = `(${text})`;
        if (isFunctionDeclaration(functionNode)) registrations.push(`__tsRegisterRecipe(${JSON.stringify(binding.name)}, ${binding.name});`);
        else {
          edits.push({ start: functionStart, end: functionStart, text: `__tsRegisterRecipe(${JSON.stringify(binding.name)}, (` });
          edits.push({ start: functionNode.end, end: functionNode.end, text: '))' });
        }
      }
      return [...imports, ...registrations].join('\n') + '\n' + applyEdits(source, edits).replace(/^\/\/# sourceMappingURL=.*$/m, '');
    } finally { await lease.dispose(); }
  }
}
