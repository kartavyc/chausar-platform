// Row 0 of the one-shot A1 batch: a chat or a network search holds each preview against its own budget by giving the
// answer a models port with one preview swapped in. The host's port is frozen (host.ts #modelsProxy), and a Proxy may not
// return a different value for a frozen property, so the swap is a plain object of the port's bound methods.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelPort } from '../runtime/venture/contracts.ts';
import { withPreview } from '../runtime/venture/models/wrap.ts';

function frozenPort(calls: string[]): ModelPort {
  const inner = {
    status() { calls.push('status'); return { tiers: {} } as never; },
    presets() { return []; },
    async checkCli() {},
    async generate() { calls.push('generate'); return null as never; },
    async preview() { calls.push('preview'); return null; },
    async runPreview() { calls.push('runPreview'); return null as never; },
  };
  return Object.freeze({
    status: (ctx: never) => inner.status.call(inner),
    presets: () => inner.presets(),
    checkCli: (id: never) => inner.checkCli(),
    generate: (ctx: never, task: never) => inner.generate(),
    preview: (ctx: never, task: never) => inner.preview(),
    runPreview: (ctx: never, id: never, digest: never, validate: never) => inner.runPreview(),
  }) as unknown as ModelPort;
}

test('wrap: a frozen port gets its preview swapped without a TypeError, and every other method still reaches it', async () => {
  const calls: string[] = [];
  const port = frozenPort(calls);
  const seen: string[] = [];
  const models = withPreview(port, async (ctx, task) => { seen.push('mine'); return port.preview(ctx, task); });
  await models.preview({} as never, {} as never);
  models.status({} as never);
  await models.generate({} as never, {} as never);
  await models.runPreview({} as never, 'c', 'd', () => null);
  assert.deepEqual(seen, ['mine']);
  assert.deepEqual(calls, ['preview', 'status', 'generate', 'runPreview']);
  assert.equal(Object.isFrozen(models), true, 'the wrapped port is frozen like the host one');
});

test('wrap: a class instance keeps its own this, and methods on its prototype are carried over', async () => {
  class Port {
    count = 0;
    status() { this.count += 1; return { tiers: {} } as never; }
    presets() { return []; }
    async checkCli() {}
    async generate() { return null as never; }
    async preview() { return null; }
    async runPreview() { return null as never; }
    async inspectCli() { this.count += 10; return null as never; }
  }
  const port = new Port();
  const models = withPreview(port as unknown as ModelPort, async () => null);
  models.status({} as never);
  await models.inspectCli!('codex' as never, {} as never);
  assert.equal(port.count, 11);
});
