import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { RENDERER_METHOD_NAMES } from '../../src/engine/methods.gen';

// The generated tuple and EngineMethods are held equal by the compile-time contract check.
const { METHODS } = createRequire(import.meta.url)('../../../desktop/ipc-contract.cjs') as { METHODS: readonly string[] };
const called = RENDERER_METHOD_NAMES;
describe('the desktop allows every method the UI calls', () => {
  it('reads the UI method list', () => {
    expect(called.length).toBeGreaterThan(80);
    expect(called).toContain('venture.queue.list');
  });
  it('finds each one in the IPC allowlist', () => {
    const allowed = new Set(METHODS);
    expect(called.filter(method => !allowed.has(method))).toEqual([]);
  });
});
