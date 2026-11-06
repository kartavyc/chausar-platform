import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { ALL_METHODS, CORE_METHODS, DRAFT_DESK_METHODS, RENDERER_METHODS, VENTURE_METHODS, PRE_VAULT_METHODS, DRAFT_METHODS } from '../runtime/method-registry.ts';
import { CUSTODY_METHODS } from '../runtime/workspace-custody-contracts.ts';

const { METHODS } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
test('method registry contains unique names and preserves every current engine entry point', () => {
  assert.equal(new Set(ALL_METHODS).size, ALL_METHODS.length);
  for (const name of ALL_METHODS) assert.match(name, /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/);
  for (const name of METHODS) assert.ok(ALL_METHODS.includes(name), name);
  for (const name of CUSTODY_METHODS) assert.ok(CORE_METHODS.some(row => row.name === name), name);
});
test('registry agrees with engine dispatch, including the main-only custody operations', async () => {
  const source = (await Promise.all(['engine.ts', 'legacy/dispatch.ts'].map(file => readFile(new URL('../runtime/' + file, import.meta.url), 'utf8')))).join('\n');
  const dispatch = new Set([...source.matchAll(/(?:case\s+|method\s*===\s*)'([^']+)'/g)].map(row => row[1]!));
  for (const name of VENTURE_METHODS) dispatch.add(name);
  for (const name of ALL_METHODS) assert.ok(dispatch.has(name), `No engine dispatcher for ${name}`);
  for (const name of dispatch) if (name.includes('.')) assert.ok(ALL_METHODS.includes(name), `Unregistered dispatcher: ${name}`);
  assert.ok(ALL_METHODS.includes('workspace.import'));
  assert.ok(ALL_METHODS.includes('workspace.backups.copyTo'));
});
test('renderer registry grants exactly the UI declared methods', async () => {
  const source = await readFile(new URL('../../app/ui/src/engine/types.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true);
  const methods = tree.statements.find((row): row is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(row) && row.name.text === 'EngineMethods');
  assert.ok(methods && ts.isIntersectionTypeNode(methods.type));
  const [venture, core] = methods.type.types;
  assert.ok(venture && ts.isMappedTypeNode(venture));
  assert.equal(venture.typeParameter.constraint?.getText(tree), 'keyof VenturePayloads');
  assert.ok(venture.type && ts.isTypeLiteralNode(venture.type));
  assert.deepEqual(venture.type.members.map(row => row.getText(tree).replace(/\s/g, '')), ['params:MextendskeyofUiPayloadOverrides?UiPayloadOverrides[M]:VenturePayloads[M];', 'result:VentureResults[M]']);
  const overrides = tree.statements.find((row): row is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(row) && row.name.text === 'UiPayloadOverrides');
  assert.ok(overrides && ts.isTypeLiteralNode(overrides.type));
  assert.deepEqual(overrides.type.members.map(row => row.getText(tree).replace(/\s/g, '')), [
    "'venture.desk.act':Omit<VenturePayloads['venture.desk.act'],'payload'>&{payload:unknown};",
    "'venture.apps.call':Omit<VenturePayloads['venture.apps.call'],'arguments'>&{arguments:Record<string,unknown>};",
    "'venture.settings.draft':Omit<VenturePayloads['venture.settings.draft'],'values'>&{values:unknown};",
  ]);
  assert.ok(core && ts.isTypeLiteralNode(core));
  const names = [...VENTURE_METHODS, ...core.members.map(row => { assert.ok(ts.isPropertySignature(row) && ts.isStringLiteral(row.name)); return row.name.text; })];
  assert.deepEqual([...RENDERER_METHODS].sort(), names.sort());
  assert.equal(DRAFT_DESK_METHODS.length, 15);
});

test('desktop refuses the engine-only surface that the UI never declares', () => {
  assert.deepEqual([...METHODS].sort(), [...RENDERER_METHODS].sort());
});

test('main-only file operations pass host validation and remain unavailable to the renderer', () => {
  const { validateRequest, validateHostRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
  for (const input of [
    { method: 'workspace.import', payload: { file: 'sample-copy.json' } },
    { method: 'workspace.backups.copyTo', payload: { folder: 'sample-backups', confirmed: true } },
    { method: 'workspace.export', payload: { path: 'sample-copy.json', confirmed: true } },
  ]) {
    assert.throws(() => validateRequest(input), { code: 'INVALID_REQUEST' });
    assert.deepEqual(validateHostRequest(input), input);
  }
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: {}, host: true }), { code: 'INVALID_REQUEST' });
});


test('venture routing uses the registry without repeated switch arms', async () => {
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /case ['"]venture\./);
  assert.match(source, /DRAFT_DESK_DISPATCH\.has\(method\)/);
  assert.match(source, /VENTURE_DISPATCH\.has\(method\)/);
});

test('the agent checklist names the contract generator', async () => {
  assert.match(await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8'), /node scripts\/gen-contract\.mjs/);
});

// Wave 6 adds consent/native approvals, tool sign-in, client records, apps, voice and feedback.
// One-shot A2 adds Codex trust; C2 find, C3 work, C4 invoice/routines, C5 seven, C6 payment, C7 nineteen.
test('one pinned registry count covers venture, hosted and renderer methods', () => {
  assert.equal(VENTURE_METHODS.length, 423);
  assert.equal(VENTURE_METHODS.filter(name => !PRE_VAULT_METHODS.includes(name) && !DRAFT_METHODS.includes(name)).length, 403);
  assert.equal(RENDERER_METHODS.length, 455);
});

test('UI request names pass renderer validation and cannot use method-name escape casts', async () => {
  const { validateRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
  const visitDirectory = async (directory: URL) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
      if (item.isDirectory()) { await visitDirectory(url); continue; }
      if (!/\.tsx?$/.test(item.name) || item.name.endsWith('.gen.ts')) continue;
      const source = ts.createSourceFile(item.name, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'request' || ts.isIdentifier(node.expression) && node.expression.text === 'useResource')) {
          let method = node.arguments[0];
          while (method && (ts.isAsExpression(method) || ts.isTypeAssertionExpression(method) || ts.isParenthesizedExpression(method))) {
            if (ts.isAsExpression(method) || ts.isTypeAssertionExpression(method)) assert.ok(method.type.kind !== ts.SyntaxKind.AnyKeyword && !(ts.isTypeReferenceNode(method.type) && method.type.typeName.getText(source) === 'MethodName'), `Unchecked method cast: ${url.pathname}`);
            method = method.expression;
          }
          if (method && ts.isStringLiteral(method)) assert.doesNotThrow(() => validateRequest({ method: method.text, payload: {} }), `${url.pathname}: ${method.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  await visitDirectory(new URL('../../app/ui/src/', import.meta.url));
});

test('untrusted UI fields still reject non-JSON input at the real desktop boundary', () => {
  const { validateRequest } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
  const cases = [
    { method: 'venture.desk.act', field: 'payload', rest: { playbook: 'virtual-assistant', kind: 'room', action: 'create', id: 'sample-order' } },
    { method: 'venture.apps.call', field: 'arguments', rest: { appId: 'sample-app', tool: 'sample-tool' } },
    { method: 'venture.settings.draft', field: 'values', rest: { kind: 'sample-form' } },
  ];
  for (const row of cases) {
    for (const invalid of [() => 'never called', { nested: Infinity }, { nested: 1n }, new Date()]) {
      assert.throws(() => validateRequest({ method: row.method, payload: { ...row.rest, [row.field]: invalid } }), { code: 'INVALID_REQUEST' });
    }
    const request = { method: row.method, payload: { ...row.rest, [row.field]: { text: 'sample', count: 2, accepted: false, empty: null } } };
    assert.deepEqual(validateRequest(request), request);
  }
});
