import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const contracts = new URL('../runtime/venture/contracts.ts', import.meta.url);
const values = new URL('../runtime/venture/contract-values.ts', import.meta.url);

test('venture contracts erase to an empty module with no runtime imports or exports', async () => {
  const stripped = stripTypeScriptTypes(await readFile(contracts, 'utf8'));
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, stripped);
  assert.equal(scanner.scan(), ts.SyntaxKind.EndOfFileToken, 'Move every runtime value and import to contract-values.ts.');
});

test('contract-values exports exactly its declared runtime values and contains no type declarations', async () => {
  const source = await readFile(values, 'utf8');
  const parsed = ts.createSourceFile('contract-values.ts', source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of parsed.statements) {
    assert.ok(!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement), 'Types belong in contracts.ts.');
    if (ts.isVariableStatement(statement)) names.push(...statement.declarationList.declarations.map(row => { assert.ok(ts.isIdentifier(row.name)); return row.name.text; }));
    else if (ts.isFunctionDeclaration(statement)) { assert.ok(statement.name); names.push(statement.name.text); }
    else if (ts.isExportDeclaration(statement)) {
      assert.equal(statement.isTypeOnly, false);
      assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause));
      names.push(...statement.exportClause.elements.map(row => row.name.text));
    }
  }
  assert.deepEqual(Object.keys(await import(values.href)).sort(), names.sort());
});
test('importing the venture host never resolves the types-only contract module', () => {
  const script = `
    import { registerHooks } from 'node:module';
    const seen = new Set();
    registerHooks({ resolve(specifier, context, next) { const resolved = next(specifier, context); seen.add(resolved.url); return resolved; } });
    await import(${JSON.stringify(new URL('../runtime/venture/host.ts', import.meta.url).href)});
    process.stdout.write(JSON.stringify([...seen].filter(url => url === ${JSON.stringify(contracts.href)})));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [], 'The venture host must not load contracts.ts at runtime.');
});