import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const printer = ts.createPrinter({ removeComments: true });
export function declarations(path) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return new Map(tree.statements.filter(node => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)).map(node => [node.name.text, { start: node.getStart(tree), end: node.end, text: printer.printNode(ts.EmitHint.Unspecified, node, tree).replace(/\s+/g, '') }]));
}
export function contractTypeDeclarations(path, seen = new Set()) {
  const absolute = resolve(root, path);
  if (seen.has(absolute)) return new Map();
  seen.add(absolute);
  const result = declarations(path);
  const tree = ts.createSourceFile(path, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const row of tree.statements) {
    if (!ts.isExportDeclaration(row) || !row.isTypeOnly || row.exportClause || !row.moduleSpecifier || !ts.isStringLiteral(row.moduleSpecifier)) continue;
    const target = relative(root, resolve(dirname(absolute), row.moduleSpecifier.text));
    for (const [name, value] of contractTypeDeclarations(target, seen)) result.set(name, value);
  }
  return result;
}
export function typeDrift() {
  const ui = declarations('app/ui/src/engine/types.ts'), engine = contractTypeDeclarations('platform/runtime/venture/contracts.ts');
  const names = [...ui.keys()].filter(name => engine.has(name)).sort();
  return { names, identical: names.filter(name => ui.get(name).text === engine.get(name).text), ui: ui.size, engine: engine.size };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(typeDrift(), null, 2) + '\n');
