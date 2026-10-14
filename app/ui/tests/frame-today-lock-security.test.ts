import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeEngine } from '../src/bridge/fake.ts';
import { createHostController } from '../src/host/controller.ts';
import { externalUrl } from '../src/bridge/shell.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const desktop = require('../../desktop/shell-ipc.cjs') as { externalUrl(input: unknown): string | null };

test('a refused engine lock keeps the screen locked, retries, and nothing but an unlock leaves it', async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  let refusals = 2, locks = 0;
  const port = { async request(method: string, payload: Record<string, unknown> = {}) {
    if (method === 'workspace.lock') {
      locks++;
      if (refusals-- > 0) throw Object.assign(new Error('busy'), { code: 'VAULT_BUSY' });
    }
    return engine.request(method, payload);
  } };
  const controller = createHostController(port, { todayProducer: await engine.todayProducer() });
  try {
    await controller.refresh();
    assert.equal(controller.snapshot().phase, 'ready');
    await controller.lock();
    assert.equal(controller.snapshot().phase, 'locked');
    assert.equal(locks, 3, 'The engine lock is asked for again until it is accepted.');
    await controller.refresh();
    assert.equal(controller.snapshot().phase, 'locked', 'A refresh never leaves a lock.');
    controller.invalidate('ACCESS_DENIED');
    assert.equal(controller.snapshot().phase, 'locked', 'An invalidation never downgrades a lock to unavailable.');
    assert.equal(controller.snapshot().context, null);
  } finally { controller.dispose(); }
});

test('the open-a-link rule is the same in the renderer and in main, and refuses disguised or local addresses', () => {
  const cases: readonly [string, string | null][] = [
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['https://EXAMPLE.com:443/a/../b', 'https://example.com/b'],
    ['https://аpple.com/', null],
    ['https://evil.com\\@good.com/', null],
    ['https://example.com/‮gnp.exe', null],
    ['https://printer.local/', null],
    ['https://router.lan/', null],
    ['https://x.internal/', null],
    ['https://x.home.arpa/', null],
    ['https://a.example:22/', null],
    ['http://example.com/', null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(externalUrl(input), expected, input);
    assert.equal(desktop.externalUrl(input), expected, input);
  }
});
