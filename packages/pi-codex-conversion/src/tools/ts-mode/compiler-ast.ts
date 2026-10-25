import {
  isArrowFunction, isBindingElement, isClassDeclaration, isEnumDeclaration,
  isFunctionDeclaration, isFunctionExpression, isIdentifier, isImportDeclaration,
  isInterfaceDeclaration, isModuleDeclaration, isNamedImports, isNamespaceImport,
  isStringLiteral, isTypeAliasDeclaration, isVariableStatement, isTypeNode, NodeFlags,
  SyntaxKind, type BindingName, type Node, type SourceFile,
} from 'tsrs/unstable/ast';
import { SymbolFlags, type Checker } from 'tsrs/unstable/async';
import type { TsBinding, TsImport } from './compiler-contract.js';

export interface BindingNode {
  name: string;
  kind: TsBinding['kind'];
  node: Node;
  functionNode?: Node;
}

function names(name: BindingName): string[] {
  if (isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element => isBindingElement(element) && element.name ? names(element.name) : []);
}

export function inventory(file: SourceFile, start = 0): BindingNode[] {
  const result: BindingNode[] = [];
  for (const statement of file.statements) {
    if (statement.getStart(file) < start) continue;
    if (isVariableStatement(statement)) {
      const kind = statement.declarationList.flags & NodeFlags.Const ? 'const' : 'let';
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        const functionNode = isIdentifier(declaration.name) && initializer && (isArrowFunction(initializer) || isFunctionExpression(initializer)) ? initializer : undefined;
        for (const name of names(declaration.name)) {
          result.push({ name, kind, node: declaration, ...(functionNode ? { functionNode } : {}) });
        }
      }
    } else if (isFunctionDeclaration(statement) && statement.name) {
      result.push({ name: statement.name.text, kind: 'function', node: statement, ...(statement.body ? { functionNode: statement } : {}) });
    } else if (isClassDeclaration(statement) && statement.name) {
      result.push({ name: statement.name.text, kind: 'class', node: statement });
    } else if (isEnumDeclaration(statement)) {
      result.push({ name: statement.name.text, kind: 'enum', node: statement });
    } else if (isModuleDeclaration(statement) && isIdentifier(statement.name)) {
      result.push({ name: statement.name.text, kind: 'namespace', node: statement });
    } else if (isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)) {
      result.push({ name: statement.name.text, kind: 'type', node: statement });
    } else if (isImportDeclaration(statement)) {
      const recipe = importRecipe(statement);
      for (const binding of recipe?.bindings ?? []) result.push({ name: binding.local, kind: recipe?.typeOnly || binding.typeOnly ? 'type' : 'import', node: statement });
    }
  }
  return result;
}

export function importRecipe(node: Node): TsImport | undefined {
  if (!isImportDeclaration(node) || !isStringLiteral(node.moduleSpecifier)) return undefined;
  const clause = node.importClause;
  const bindings: TsImport['bindings'] = [];
  if (clause?.name) bindings.push({ imported: 'default', local: clause.name.text });
  if (clause?.namedBindings) {
    if (isNamespaceImport(clause.namedBindings)) bindings.push({ imported: '*', local: clause.namedBindings.name.text });
    if (isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.push({ imported: element.propertyName?.text ?? element.name.text, local: element.name.text, ...(element.isTypeOnly ? { typeOnly: true } : {}) });
      }
    }
  }
  const attributes: Record<string, string> = {};
  for (const attribute of node.attributes?.attributes ?? []) {
    if (isStringLiteral(attribute.value)) attributes[attribute.name.text] = attribute.value.text;
  }
  return { specifier: node.moduleSpecifier.text, bindings, typeOnly: clause?.phaseModifier === SyntaxKind.TypeKeyword,
    ...(Object.keys(attributes).length ? { attributes } : {}),
  };
}

/** Checker symbols distinguish local parameters/properties from captured bindings. */
export async function freeReferences(node: Node, checker: Checker, typesOnly = false): Promise<string[]> {
  const identifiers: Node[] = [];
  const walk = (child: Node, inType = false): void => {
    const type = inType || isTypeNode(child);
    if (isIdentifier(child) && (!typesOnly || type)) identifiers.push(child);
    child.forEachChild(nested => walk(nested, type));
  };
  walk(node);
  const symbols = await checker.getSymbolAtLocation(identifiers);
  const free = new Set<string>();
  for (const symbol of symbols) {
    if (!symbol || !(symbol.flags & (SymbolFlags.Value | SymbolFlags.Type | SymbolFlags.Alias)) || symbol.flags & (SymbolFlags.Property | SymbolFlags.Method | SymbolFlags.Accessor | SymbolFlags.EnumMember)) continue;
    const declarations = await Promise.all(symbol.declarations.map(declaration => declaration.resolve()));
    if (declarations.length && declarations.every(declaration => declaration && declaration.getSourceFile() === node.getSourceFile() && declaration.pos >= node.pos && declaration.end <= node.end)) continue;
    free.add(symbol.name);
  }
  return [...free].sort();
}

export function applyEdits(source: string, edits: { start: number; end: number; text: string }[]): string {
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
