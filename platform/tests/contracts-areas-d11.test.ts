import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
const base = new URL('../runtime/venture/', import.meta.url);
test('venture contracts are a type-only barrel with bounded area files', async () => {
  const text = await readFile(new URL('contracts.ts', base), 'utf8');
  const tree = ts.createSourceFile('contracts.ts', text, ts.ScriptTarget.Latest, true);
  assert.ok(text.split(/\r?\n/).length < 100, 'The contract entry point is under 100 lines.');
  assert.ok(tree.statements.length > 0);
  for (const row of tree.statements) assert.ok(ts.isExportDeclaration(row) && row.isTypeOnly && row.moduleSpecifier, 'Only named type re-exports belong in the entry point.');
  const files = (await readdir(new URL('contracts/', base))).filter(file => file.endsWith('.ts'));
  assert.ok(files.length >= 8, 'Each contract area has its own file.');
  for (const file of files) {
    const source = await readFile(new URL('contracts/' + file, base), 'utf8');
    assert.ok(source.split(/\r?\n/).length <= 2000, file + ' exceeds the area limit.');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const row of parsed.statements) assert.ok(ts.isTypeAliasDeclaration(row) || ts.isInterfaceDeclaration(row) || ts.isImportDeclaration(row) && row.importClause?.isTypeOnly || ts.isExportDeclaration(row) && row.isTypeOnly, file + ' must remain erasable types only.');
  }
});
