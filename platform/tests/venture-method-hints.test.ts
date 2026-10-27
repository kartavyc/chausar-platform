// Ink v2 wave 4, package 4J10 (H38): method hints and one method set across every surface. METHOD_HINTS gives every
// venture method readOnly, undoable, idempotent and reachesOutside, made from VENTURE_METHODS itself; this test checks
// that the same methods are in the engine's list, the hints, the desktop's IPC allowlist, the Ink app's method map and
// the hosted allow-list (all but the pre-vault and draft methods, which the hosted server answers or refuses itself),
// with the pinned counts, and that every read-level method is readOnly and every readOnly method is a read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DRAFT_METHODS, PRE_VAULT_METHODS, VENTURE_METHODS, W4_METHOD_LEVELS, W4_METHODS, W5_METHOD_LEVELS, W5_METHODS } from '../runtime/venture/contracts.ts';
import { METHOD_HINTS, METHOD_LEVEL_OF } from '../runtime/venture/method-hints.ts';
import { ACTOR_ACTIONS } from '../runtime/hosted/runtime/contract.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import type { Context } from '../runtime/contracts.ts';
import { seedBlueprint, setup } from './venture-views-env.ts';

const { METHODS: IPC_METHODS } = createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs') as { METHODS: readonly string[] };
const types = readFileSync(new URL('../../app/ui/src/engine/types.ts', import.meta.url), 'utf8');
const block = types.slice(types.indexOf('export interface EngineMethods'), types.indexOf('export type MethodName'));
const UI_METHODS = [...block.matchAll(/^\s*'([a-z]+(?:\.[A-Za-z]+)+)':/gm)].map(match => match[1]!);
const venture = (methods: readonly string[]) => [...new Set(methods.filter(method => method.startsWith('venture.')))].sort();
const sorted = (methods: readonly string[]) => [...methods].sort();

test('the pinned counts: 302 venture methods, 290 reached through the hosted host', () => {
  // 5-0 added the 34 wave 5 methods (contracts.ts W5_METHODS); all reach the hosted host.
  assert.equal(VENTURE_METHODS.length, 302);
  const hosted = venture(ACTOR_ACTIONS);
  assert.equal(hosted.length, 290);
  assert.deepEqual(hosted, sorted(VENTURE_METHODS.filter(method => !PRE_VAULT_METHODS.includes(method) && !DRAFT_METHODS.includes(method))));
});

test('one method set: the engine list, the hints, the desktop allowlist, the Ink method map and the hosted allow-list', () => {
  const engine = sorted(VENTURE_METHODS);
  assert.deepEqual(Object.keys(METHOD_HINTS), [...VENTURE_METHODS], 'the hints are made from the method list, in its order');
  assert.deepEqual(Object.keys(METHOD_LEVEL_OF), [...VENTURE_METHODS]);
  assert.deepEqual(venture(IPC_METHODS), engine, 'the desktop IPC allowlist');
  assert.deepEqual(venture(UI_METHODS), engine, 'the Ink app method map');
  // The hosted server: every method but the pre-vault three (answered without an actor) and the nine draft methods
  // (not offered on hosted at all, HOSTED_NOT_AVAILABLE).
  const hosted = new Set(venture(ACTOR_ACTIONS));
  for (const method of VENTURE_METHODS) {
    const answeredElsewhere = PRE_VAULT_METHODS.includes(method) || DRAFT_METHODS.includes(method);
    assert.equal(hosted.has(method), !answeredElsewhere, method);
  }
});

test('every hint is the four booleans and nothing else', () => {
  for (const method of VENTURE_METHODS) {
    const hint = METHOD_HINTS[method];
    assert.deepEqual(Object.keys(hint).sort(), ['idempotent', 'reachesOutside', 'readOnly', 'undoable'], method);
    for (const value of Object.values(hint)) assert.equal(typeof value, 'boolean', method);
    assert.ok(Object.isFrozen(hint), method);
  }
});

test('every read-level method is readOnly, and only reads are; a read is safe to repeat and has nothing to undo', () => {
  for (const method of W4_METHODS) assert.equal(METHOD_LEVEL_OF[method], W4_METHOD_LEVELS[method], `${method}: wave 4 levels are the contract's`);
  // 5-0: and wave 5's.
  for (const method of W5_METHODS) assert.equal(METHOD_LEVEL_OF[method], W5_METHOD_LEVELS[method], `${method}: wave 5 levels are the contract's`);
  for (const method of VENTURE_METHODS) {
    const hint = METHOD_HINTS[method];
    const read = METHOD_LEVEL_OF[method] === 'read';
    assert.equal(hint.readOnly, read, `${method} (${METHOD_LEVEL_OF[method]})`);
    if (hint.readOnly) assert.ok(hint.idempotent && hint.undoable, `${method}: a read is safe to repeat`);
  }
});

test('what the hints say about the methods that matter most', () => {
  // Real money and outside effects are never marked undoable.
  for (const method of ['venture.invoice.issue', 'venture.payment.record', 'venture.credit.issue', 'venture.bills.pay', 'venture.network.forget', 'venture.journal.acceptBreak'] as const) {
    assert.equal(METHOD_HINTS[method].undoable, false, method);
  }
  // Each one that sends something off this computer says so.
  for (const method of ['venture.delivery.approve', 'venture.delivery.judgeSend', 'venture.posting.signIn', 'venture.site.apply', 'venture.share.create', 'venture.mailbox.sync', 'venture.agents.thread.send', 'venture.chief.thread.send', 'venture.queue.decide'] as const) {
    assert.equal(METHOD_HINTS[method].reachesOutside, true, method);
  }
  // A handoff opens the owner's own mail or LinkedIn; Chausar never sends it.
  assert.equal(METHOD_HINTS['venture.outreach.open'].reachesOutside, false);
  assert.deepEqual(METHOD_HINTS['venture.journal.chain'], { readOnly: true, undoable: true, idempotent: true, reachesOutside: false });
});

/** Methods whose empty request only reads (4G3: venture.notify.relay {} answers the relay); setting one is its level. */
const READS_WHEN_EMPTY: ReadonlySet<string> = new Set(['venture.notify.relay']);

test('the levels hold through the host: a viewer is never refused a read, and whatever a viewer may run is a read', async () => {
  const env = await setup();
  await seedBlueprint(env);
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test' } as never);
  const wrong: string[] = [];
  try {
    for (const method of VENTURE_METHODS) {
      let refused = '';
      try { await host.request(viewer, method, {}); } catch (error) { refused = (error as { code?: string }).code ?? 'ERROR'; }
      const read = METHOD_LEVEL_OF[method] === 'read';
      // A request with no fields is often refused for its fields first, which says nothing about the level.
      if (read && refused === 'FORBIDDEN') wrong.push(`${method}: a read refused to a viewer`);
      if (!read && refused === '' && !READS_WHEN_EMPTY.has(method)) wrong.push(`${method}: a viewer ran it, so it is a read`);
    }
  } finally {
    host.close();
  }
  assert.deepEqual(wrong, []);
});
