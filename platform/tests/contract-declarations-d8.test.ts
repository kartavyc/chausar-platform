import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('generated UI contract declares engine types without importing runtime implementation files', async () => {
  const source = await readFile(new URL('../../app/ui/src/engine/contract.gen.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('contract.gen.ts', source, ts.ScriptTarget.Latest, true);
  const imports = tree.statements.filter(ts.isImportDeclaration);
  for (const row of imports) {
    assert.ok(row.importClause?.isTypeOnly, 'The contract has no runtime imports.');
    assert.ok(ts.isStringLiteral(row.moduleSpecifier) && !row.moduleSpecifier.text.startsWith('.'), 'All local type dependencies must be included as declarations.');
  }
  assert.match(source, /export type QueueRow\s*=/);
  assert.match(source, /export type VenturePayloads\s*=/);
  assert.match(source, /export type VentureResults\s*=/);
  assert.ok(!tree.statements.some(ts.isFunctionDeclaration), 'No runtime function belongs in the UI contract.');
});
