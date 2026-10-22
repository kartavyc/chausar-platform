import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Spec section 9: every engine method the UI can call is in the desktop's IPC allowlist, so nothing the app shows
 * fails on the desktop with "not allowed". The UI's methods are the keys of EngineMethods in src/engine/types.ts.
 */
const require = createRequire(import.meta.url);
const { METHODS } = require('../../../desktop/ipc-contract.cjs') as { METHODS: readonly string[] };

const types = readFileSync(join(import.meta.dirname, '../../src/engine/types.ts'), 'utf8');
const block = types.slice(types.indexOf('export interface EngineMethods'), types.indexOf('export type MethodName'));
const called = [...block.matchAll(/^\s*'([a-z]+(?:\.[A-Za-z]+)+)':/gm)].map((m) => m[1]!);

describe('the desktop allows every method the UI calls', () => {
  it('reads the UI method list', () => {
    expect(called.length).toBeGreaterThan(80);
    expect(called).toContain('venture.queue.list');
  });

  it('finds each one in the IPC allowlist', () => {
    const allowed = new Set(METHODS);
    expect(called.filter((method) => !allowed.has(method))).toEqual([]);
  });
});
