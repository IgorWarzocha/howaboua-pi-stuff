export interface TsDiagnostic {
  code: number;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface TsImport {
  specifier: string;
  bindings: { imported: string; local: string; typeOnly?: true }[];
  typeOnly: boolean;
  attributes?: Record<string, string>;
}

export interface TsImportReference {
  specifier: string;
  /** Span of the quoted module literal, including quotes. */
  start: number;
  end: number;
}

export interface TsBinding {
  name: string;
  kind: 'let' | 'const' | 'function' | 'class' | 'enum' | 'namespace' | 'type' | 'import';
  declaration: string;
  type: string;
  /** Executable JavaScript expression for portable top-level functions. */
  source?: string;
  freeReferences: string[];
}

export interface TsCompileInput {
  source: string;
  /** Live cells execute in a retained lexical kernel, not a portable snapshot worker. */
  mode?: 'live' | 'isolated';
  baselineDeclarations: string;
  globalsDeclaration?: string;
  /** Original import specifier to resolved type entry point. */
  moduleResolutions?: ReadonlyMap<string, string>;
  /** Original import specifier to runtime URL or Node built-in specifier. */
  runtimeSpecifiers?: ReadonlyMap<string, string>;
}

export type TsCompileResult =
  | { ok: false; diagnostics: TsDiagnostic[] }
  | {
      ok: true;
      javascript: string;
      sourceMap?: string;
      declarations: string;
      bindings: TsBinding[];
      imports: TsImport[];
    };
