// A2: the AI provider's own status page, read through the network guard when a tool's test or last task failed, shown
// with its source and the time it was read; nothing is said when it cannot be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderStatusReader, STATUS_WORDS, statusFromPage } from '../runtime/venture/models/provider-status.ts';
import type { NetAddress, PinnedTarget } from '../runtime/venture/core/net-guard.ts';

const AT = '2026-11-03T10:00:00.000Z';
const page = (indicator: string) => JSON.stringify({ page: { id: 'x', name: 'Example', url: 'https://status.example' }, status: { indicator, description: 'Partial outage: free text never shown' } });

test('the page\'s indicator, never its text: problems in owner words, else nothing to say', () => {
  assert.deepEqual(statusFromPage('claude', page('minor'), AT), { provider: 'claude', label: 'Claude', state: 'problems', line: 'Claude is having problems right now, not you.', source: 'status.claude.com', readAt: AT });
  assert.equal(statusFromPage('openai', page('major'), AT).line, STATUS_WORDS.problems('OpenAI'));
  assert.deepEqual([statusFromPage('openai', page('none'), AT).state, statusFromPage('openai', page('none'), AT).line], ['ok', null]);
  for (const body of ['not json', '{}', page('purple')]) assert.deepEqual([statusFromPage('claude', body, AT).state, statusFromPage('claude', body, AT).line], ['unknown', null]);
});

test('read through the guard as Chausar, kept for two minutes; a refused or private address says nothing', async () => {
  const sent: PinnedTarget[] = [];
  let now = Date.parse(AT);
  const publicAddress = async (): Promise<NetAddress[]> => [{ address: '93.184.216.34', family: 4 }];
  const reader = new ProviderStatusReader({ now: () => new Date(now), net: { resolve: publicAddress, send: async target => { sent.push(target); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(page('critical')) }; } } });
  const first = await reader.read('claude');
  assert.deepEqual([first.state, first.source, first.readAt], ['problems', 'status.claude.com', AT]);
  assert.equal(sent[0]!.url.href, 'https://status.claude.com/api/v2/status.json');
  assert.equal(sent[0]!.method, 'GET');
  assert.match(String(sent[0]!.headers['user-agent']), /^Chausar\//);
  await reader.read('claude');
  assert.equal(sent.length, 1, 'kept for two minutes');
  now += 2 * 60_000;
  await reader.read('claude');
  assert.equal(sent.length, 2);
  const inside = new ProviderStatusReader({ net: { resolve: async () => [{ address: '127.0.0.1', family: 4 }], send: async () => { throw new Error('never sent'); } } });
  assert.deepEqual([(await inside.read('openai')).state, (await inside.read('openai')).line], ['unknown', null]);
});
