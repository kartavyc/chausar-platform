// Package 4D3 (Ink v2 wave 4) through the real host, as venture-network-host.test.ts does for 4D1: the four search
// methods are app only and prepare level, so the phone is refused before they run and a member who can only read is
// refused before anything is sent; from the app they run. The host composes no web search and no AI here, so a search
// says it needs the owner's AI and "Before you write" says web search is not set up, in its structured state too.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, W4_METHOD_LEVELS } from '../runtime/venture/contracts.ts';
import type { PersonResearch, VentureMethod } from '../runtime/venture/contracts.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { CONNECTIONS } from './venture-network-env.ts';

const METHODS = ['venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research'] as const satisfies readonly VentureMethod[];

/** The real host over the test store. */
function hostFor(env: Env): VentureHost {
  return new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test' });
}

test('the four search methods are app only and prepare level, through the host', async () => {
  for (const method of METHODS) {
    assert.ok(APP_ONLY_METHODS.includes(method), `${method} is app only`);
    assert.equal(W4_METHOD_LEVELS[method], 'prepare', method);
  }
  const env = await setup();
  const host = hostFor(env);
  await host.request(owner, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
  const asha = listRecords(env.store.read(), 'venture-person').find(person => person.name === 'Asha Rao')!;
  const payloads: Record<typeof METHODS[number], Record<string, unknown>> = {
    'venture.network.search': { text: 'founders in Pune who sell skincare online' },
    'venture.network.searchMore': { searchId: 'netsearch_none' },
    'venture.network.saveSearch': { searchId: 'netsearch_none', name: 'Pune founders' },
    'venture.network.research': { personId: asha.id },
  };
  for (const method of METHODS) await assert.rejects(host.request(phone, method, payloads[method]), code('APP_APPROVAL_REQUIRED'), `${method} from the phone`);
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  for (const method of METHODS) await assert.rejects(host.request(viewer, method, payloads[method]), code('FORBIDDEN'), `${method} by a viewer`);

  await assert.rejects(host.request(owner, 'venture.network.search', payloads['venture.network.search']), code('NO_MODEL_CONNECTED'));
  await assert.rejects(host.request(owner, 'venture.network.searchMore', payloads['venture.network.searchMore']), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(host.request(owner, 'venture.network.saveSearch', payloads['venture.network.saveSearch']), code('INVALID_VENTURE_REQUEST'));
  const brief = await host.request(owner, 'venture.network.research', payloads['venture.network.research']) as PersonResearch;
  assert.equal(brief.web, 'not-set-up');
  assert.deepEqual(brief.lines, []);
  host.close();
});
