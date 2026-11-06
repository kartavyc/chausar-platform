import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { READS, EMPTY_READS, kindOf } from '../../src/engine/reads';
import { RENDERER_METHOD_NAMES } from '../../src/engine/methods.gen';
import { createRequire } from 'node:module';
import ts from 'typescript';
// Native loading keeps this validation from pulling implementation types into the UI program.
const { METHOD_LEVEL_OF } = createRequire(import.meta.url)('../../../../platform/runtime/venture/method-hints.ts') as { METHOD_LEVEL_OF: Record<string, string> };

const renderer = new Set<string>(RENDERER_METHOD_NAMES);
describe('derived method lists', () => {
  it('every UI read is permitted and every venture read has engine read authority', () => {
    for (const name of READS) {
      expect(renderer.has(name), name).toBe(true);
      if (name.startsWith('venture.')) expect(METHOD_LEVEL_OF[name as keyof typeof METHOD_LEVEL_OF], name).toBe('read');
    }
  });
  it('every literal fake method list stays inside the renderer contract', () => {
    const directory = new URL('../../src/engine/', import.meta.url);
    let lists = 0;
    for (const file of readdirSync(directory).filter(name => /^fake.*\.ts$/.test(name))) {
      const text = readFileSync(new URL(file, directory), 'utf8');
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const statement of tree.statements) {
        if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith('METHODS') || !declaration.initializer) continue;
          let value = declaration.initializer;
          if (ts.isNewExpression(value)) value = value.arguments?.[0]!;
          while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
          expect(value && ts.isArrayLiteralExpression(value), file).toBe(true);
          if (!value || !ts.isArrayLiteralExpression(value)) continue;
          lists++;
          for (const item of value.elements) {
            expect(ts.isStringLiteral(item), file).toBe(true);
            if (ts.isStringLiteral(item)) expect(renderer.has(item.text), `${file}: ${item.text}`).toBe(true);
          }
        }
      }
    }
    expect(lists).toBeGreaterThan(20);
  });
});

it('mixed settings requests are reads only for empty payloads', () => {
  for (const name of EMPTY_READS) {
    expect(renderer.has(name), name).toBe(true);
    expect(METHOD_LEVEL_OF[name], name).toBe('approve');
    expect(kindOf(name, {}), name).toBe('read');
    expect(kindOf(name, { changed: true }), name).toBe('write');
  }
});

it('a read resource cannot carry settings changes', () => {
  type ReadParams = import('../../src/engine/reads').ReadParams<'venture.notify.relay'>;
  const allowed: ReadParams = {};
  // @ts-expect-error A read resource must never carry a relay change.
  const denied: ReadParams = { url: 'https://example.invalid/topic' };
  expect(allowed).toEqual({}); expect(denied.url).toBeDefined();
});

it('untrusted field overrides preserve every other request field and the canonical result', () => {
  type UI = import('../../src/engine/types').EngineMethods;
  type Input = import('../../src/engine/contract.gen').VenturePayloads;
  type Result = import('../../src/engine/contract.gen').VentureResults;
  type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
  const exact: [
    Same<Omit<UI['venture.desk.act']['params'], 'payload'>, Omit<Input['venture.desk.act'], 'payload'>>,
    Same<Omit<UI['venture.apps.call']['params'], 'arguments'>, Omit<Input['venture.apps.call'], 'arguments'>>,
    Same<Omit<UI['venture.settings.draft']['params'], 'values'>, Omit<Input['venture.settings.draft'], 'values'>>,
    Same<UI['venture.desk.act']['result'], Result['venture.desk.act']>,
    Same<UI['venture.apps.call']['result'], Result['venture.apps.call']>,
    Same<UI['venture.settings.draft']['result'], Result['venture.settings.draft']>
  ] = [true, true, true, true, true, true];
  expect(exact.every(Boolean)).toBe(true);
  // @ts-expect-error Untrusted form contents do not loosen the required action name.
  const badAction: UI['venture.desk.act']['params'] = { playbook: 'virtual-assistant', kind: 'room', action: 42, payload: {} };
  expect(badAction.action).toBe(42);
});
