import { assert, test } from 'vitest';
import { assistants, inspection, languagePacks, pairing, pluginPackage, plugins } from '../../app/ui/src/screens/tools/validate.ts';
import { channels, counts, status } from '../../app/ui/src/screens/tools/adapters/phone.ts';
import { opened, proposal } from '../../app/ui/src/screens/tools/adapters/smallapps.ts';
import { detail } from '../../app/ui/src/screens/tools/adapters/wrapped.ts';
import { TOOLS_WORDS, fill } from '../../app/ui/src/screens/tools/words.ts';

// Synthetic replies only.
function invalid(fn: () => unknown) {
  let code: unknown = null;
  try { fn(); } catch (e) { code = (e as { code?: unknown }).code; }
  assert.equal(code, 'INVALID_REPLY');
}

test('every English word has a Hindi word', () => {
  assert.deepEqual(Object.keys(TOOLS_WORDS.en).sort(), Object.keys(TOOLS_WORDS.hi).sort());
  assert.equal(fill('{a} of {b}', { a: '1', b: '{a}' }), '1 of {a}');
});

test('a plugin package is parsed as data with only its known fields', () => {
  const pkg = pluginPackage(JSON.stringify({ manifest: { name: 'x' }, moduleBase64: 'AGFzbQ==', licence: 'MIT' }));
  assert.deepEqual(pkg, { manifest: { name: 'x' }, moduleBase64: 'AGFzbQ==', licence: 'MIT' });
  invalid(() => pluginPackage('not json'));
  invalid(() => pluginPackage(JSON.stringify({ manifest: {}, moduleBase64: 'AGFzbQ==', script: 'x' })));
  invalid(() => pluginPackage(JSON.stringify({ manifest: {}, moduleBase64: 'not base64!' })));
  invalid(() => pluginPackage(JSON.stringify({ manifest: [], moduleBase64: 'AGFzbQ==' })));
});

test('inspection answers always start No, and an unknown level or signature is refused', () => {
  const ok = { maker: 'm', level: 'community', version: '1', licence: 'MIT', signature: 'valid', digest: 'd', doors: [], asks: [{ id: 'a', kind: 'site', name: 'n', answer: false }], flagged: [], refused: null };
  assert.equal(inspection(ok).asks[0]!.answer, false);
  invalid(() => inspection({ ...ok, asks: [{ id: 'a', kind: 'site', name: 'n', answer: true }] }));
  invalid(() => inspection({ ...ok, level: 'trusted' }));
  invalid(() => inspection({ ...ok, signature: 'ok' }));
  invalid(() => inspection({ ...ok, digest: '' }));
});

test('plugins, packs, assistants and pairing replies are checked', () => {
  invalid(() => plugins({ plugins: [], blockedList: { version: 'v1', checkedAt: 'yesterday' } }));
  invalid(() => languagePacks({ packs: [{ id: 'x', name: 'X', cases: { passed: 61, total: 60 }, supported: true, reviewed: true }] }));
  invalid(() => assistants({ on: true, server: { version: '1', scope: 'everywhere' }, assistants: [], calls: [] }));
  invalid(() => pairing({ id: 'a', name: 'n', token: '', expiresAt: '2026-10-01' }));
});

test('other lanes\' replies are checked into view types', () => {
  // hosted-link
  invalid(() => counts({ month: '2026-10', sent: 1, budget: 40, costPaise: null, costState: 'unknown', byChannel: {} }));
  invalid(() => counts({ month: '2026-10', sent: 1, budget: 30, costPaise: '0.5', costState: 'known', byChannel: {} }));
  invalid(() => counts({ month: '2026-10', sent: 1, budget: 30, costPaise: '5', costState: 'unknown', byChannel: {} }));
  invalid(() => channels({ stale: false, refreshedAt: null, channels: [{ channel: 'sms', desktop: { enabled: false, optInAt: null }, relay: null }] }));
  invalid(() => status({ configured: true, paired: true, demo: false, pairing: null }));
  // models-ext: a small app's labels are text; a card kind the adapter does not know, or a figure without its receipt, is refused
  const figureValue = { state: 'figure', receiptId: 'rc-1', figures: [{ key: 'value', label: 'Sales', minor: '1050', display: '₹10.50', unit: 'money' }], completeness: 'reconciled-imports', gaps: [] };
  const app = { id: 'smallapp_a', onDate: '2026-10-14', cards: [{ id: 'card-a', kind: 'metric', label: '<script>', value: figureValue }] };
  const card = opened(app).cards[0]!;
  assert.equal(card.kind === 'metric' && card.label, '<script>');
  assert.equal(card.kind === 'metric' && card.value.kind === 'figures' && card.value.items[0]!.figure.kind === 'money' && card.value.items[0]!.figure.exact, '1050');
  invalid(() => opened({ ...app, cards: [{ id: 'card-a', kind: 'html', label: 'x', html: '<b>x</b>' }] }));
  invalid(() => opened({ ...app, cards: [{ id: 'card-a', kind: 'metric', label: 'x', value: { ...figureValue, receiptId: '' } }] }));
  invalid(() => opened({ ...app, cards: [{ id: 'card-a', kind: 'metric', label: 'x', value: { state: 'missing', missing: 'zero' } }] }));
  assert.deepEqual(proposal({ supported: false, state: 'not-yet', descriptor: null, message: 'Not yet.' }), { supported: false, message: 'Not yet.' });
  invalid(() => proposal({ supported: true, descriptor: null, actions: [] }));
  // models-ext wrapped tools: outside text must come marked as untrusted
  invalid(() => detail({ description: 'plain', tools: [], skills: [] }));
});
