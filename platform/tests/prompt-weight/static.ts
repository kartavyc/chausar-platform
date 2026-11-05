// D2 tasks 14 and 15: a read of every AI task the engine builds (platform/runtime/venture), by the TypeScript parser.
// It finds each object that sets `instructions` on a model task (it has a `purpose`, or spreads another task) and
// decides whether that text can change from one call to the next. Fixed shapes: a string, a module constant (also one
// imported from another module), a template or `+` of fixed parts, `[fixed, ...].join(...)`, `fixed.replace(fixed,
// fixed)`, a pass-through of another task's `.instructions`, and a choice between fixed texts (`flag ? A : B`, or a
// constant table read by key), which is a finite variant. A call to anything else is a changing part, unless it is a
// reviewed wrapper (WRAPPERS in tasks.ts), which the dynamic check runs with two different contexts.
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const VENTURE = join(REPOSITORY, 'platform/runtime/venture');

export type Site = {
  file: string; // relative to platform/runtime/venture, with forward slashes
  line: number;
  purpose: string | null; // the purpose literal on the same object, when there is one
  verdict: 'fixed' | 'wrapper' | 'changing';
  wrappers: string[]; // reviewed wrapper calls found in the expression
  why: string; // for a changing site: the part that changes
  text: string | null; // the whole text when it is one constant (no variant, no pass-through)
};

const sources = new Map<string, ts.SourceFile>();
function parse(path: string): ts.SourceFile {
  let file = sources.get(path);
  if (!file) { file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true); sources.set(path, file); }
  return file;
}

function walk(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

/** A top-level `const NAME = ...` in a file, or the module it imports NAME from. */
function resolveName(file: ts.SourceFile, name: string, seen = new Set<string>()): { file: ts.SourceFile; init: ts.Expression } | null {
  const key = `${file.fileName}#${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return { file, init: declaration.initializer };
      }
    }
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text !== name) continue;
        const target = resolve(dirname(file.fileName), (statement.moduleSpecifier as ts.StringLiteral).text);
        return resolveName(parse(target), (element.propertyName ?? element.name).text, seen);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue;
        const target = resolve(dirname(file.fileName), (statement.moduleSpecifier as ts.StringLiteral).text);
        return resolveName(parse(target), (element.propertyName ?? element.name).text, seen);
      }
    }
  }
  return null;
}

/** A `const NAME = ...` in a block around the node (a local in the builder function), nearest first. */
function resolveLocal(file: ts.SourceFile, node: ts.Identifier): { file: ts.SourceFile; init: ts.Expression } | null {
  for (let current: ts.Node | undefined = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isBlock(current)) continue;
    for (const statement of current.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === node.text && declaration.initializer && declaration.initializer !== node) return { file, init: declaration.initializer };
      }
    }
  }
  return null;
}

type Shape = { fixed: boolean; text: string | null; wrappers: string[]; why: string };
const FIXED = (text: string | null): Shape => ({ fixed: true, text, wrappers: [], why: '' });
const CHANGING = (node: ts.Node): Shape => ({ fixed: false, text: null, wrappers: [], why: node.getText().slice(0, 160) });
function all(parts: Shape[], join: (texts: string[]) => string | null): Shape {
  const bad = parts.find(part => !part.fixed);
  if (bad) return bad;
  const texts = parts.map(part => part.text);
  return { fixed: true, text: texts.every(text => text !== null) ? join(texts as string[]) : null, wrappers: parts.flatMap(part => part.wrappers), why: '' };
}

/** Whether an expression's text is fixed (or a finite set of fixed texts). */
export function shape(file: ts.SourceFile, node: ts.Expression, wrappers: ReadonlyMap<string, 'text' | 'builder'>): Shape {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return shape(file, node.expression, wrappers);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return FIXED(node.text);
  if (ts.isTemplateExpression(node)) {
    const parts: Shape[] = [FIXED(node.head.text)];
    for (const span of node.templateSpans) parts.push(shape(file, span.expression, wrappers), FIXED(span.literal.text));
    return all(parts, texts => texts.join(''));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return all([shape(file, node.left, wrappers), shape(file, node.right, wrappers)], texts => texts.join(''));
  }
  if (ts.isConditionalExpression(node)) {
    const parts = [shape(file, node.whenTrue, wrappers), shape(file, node.whenFalse, wrappers)];
    const joined = all(parts, () => null);
    return joined.fixed ? { ...joined, text: null } : joined; // a finite variant: fixed, but not one text
  }
  if (ts.isNumericLiteral(node)) return FIXED(node.text);
  if (ts.isIdentifier(node)) {
    const found = resolveLocal(file, node) ?? resolveName(file, node.text);
    return found ? shape(found.file, found.init, wrappers) : CHANGING(node);
  }
  if (ts.isPropertyAccessExpression(node)) {
    // Another task's instructions passed through (`task.instructions`), or a property of a constant object.
    if (node.name.text === 'instructions') return { fixed: true, text: null, wrappers: [], why: '' };
    if (ts.isIdentifier(node.expression)) {
      const found = resolveName(file, node.expression.text);
      const object = found && unwrap(found.init);
      if (object && ts.isObjectLiteralExpression(object)) {
        const property = object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText() === node.name.text) as ts.PropertyAssignment | undefined;
        if (property) return shape(found!.file, property.initializer, wrappers);
      }
    }
    return CHANGING(node);
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    // A constant table read by key: every value must be fixed (a finite variant).
    const found = resolveName(file, node.expression.text);
    const object = found && unwrap(found.init);
    if (object && ts.isObjectLiteralExpression(object)) {
      const parts = object.properties.map(item => ts.isPropertyAssignment(item) ? shape(found!.file, item.initializer, wrappers) : CHANGING(item));
      const joined = all(parts, () => null);
      return joined.fixed ? { ...joined, text: null } : joined;
    }
    return CHANGING(node);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      if (method === 'join' && ts.isArrayLiteralExpression(unwrap(callee.expression))) {
        const array = unwrap(callee.expression) as ts.ArrayLiteralExpression;
        const separator = node.arguments[0] ? shape(file, node.arguments[0], wrappers) : FIXED(',');
        return all([separator, ...array.elements.map(element => shape(file, element as ts.Expression, wrappers))], texts => texts.slice(1).join(texts[0]));
      }
      if (method === 'replace' && node.arguments.length === 2) {
        return all([shape(file, callee.expression, wrappers), shape(file, node.arguments[0], wrappers), shape(file, node.arguments[1], wrappers)],
          ([base, from, to]) => base.replace(from, to));
      }
      if (method === 'trim') return all([shape(file, callee.expression, wrappers)], ([text]) => text.trim());
    }
    if (ts.isIdentifier(callee) && wrappers.has(callee.text)) {
      // A reviewed wrapper: one that adds to a text keeps its first argument checked; one that builds the text from
      // flags is covered by the dynamic check alone.
      const inner = wrappers.get(callee.text) === 'text' && node.arguments[0] ? shape(file, node.arguments[0], wrappers) : FIXED('');
      return inner.fixed ? { fixed: true, text: null, wrappers: [callee.text, ...inner.wrappers], why: '' } : inner;
    }
    return CHANGING(node);
  }
  return CHANGING(node);
}

/** The expression under parentheses, `as`, `satisfies` and `Object.freeze(...)`. */
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression);
  if (ts.isCallExpression(node) && node.expression.getText() === 'Object.freeze' && node.arguments[0]) return unwrap(node.arguments[0]);
  return node;
}

const literalText = (node: ts.Expression): string | null => { const inner = unwrap(node); return ts.isStringLiteral(inner) ? inner.text : null; };

/** Every place under platform/runtime/venture that sets a model task's instructions. */
export function instructionSites(wrappers: ReadonlyMap<string, 'text' | 'builder'>): Site[] {
  const sites: Site[] = [];
  for (const path of walk(VENTURE)) {
    const file = parse(path);
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        // `instructions: x` or the shorthand `instructions` (a local of that name).
        const property = node.properties.find(item => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && item.name.getText() === 'instructions');
        const instructions = property && { initializer: ts.isPropertyAssignment(property) ? property.initializer : (property as ts.ShorthandPropertyAssignment).name, getStart: () => property.getStart() };
        const purpose = node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText() === 'purpose') as ts.PropertyAssignment | undefined;
        const spreadsTask = node.properties.some(item => ts.isSpreadAssignment(item) && /^(task|given|base)$/.test(item.expression.getText()));
        if (instructions && (purpose || spreadsTask)) {
          const result = shape(file, instructions.initializer, wrappers);
          sites.push({
            file: relative(VENTURE, path).replaceAll('\\', '/'),
            line: file.getLineAndCharacterOfPosition(instructions.getStart()).line + 1,
            purpose: purpose ? literalText(purpose.initializer) : null,
            verdict: !result.fixed ? 'changing' : result.wrappers.length ? 'wrapper' : 'fixed',
            wrappers: result.wrappers, why: result.why, text: result.fixed && !result.wrappers.length ? result.text : null,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return sites.sort((left, right) => (left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1));
}
