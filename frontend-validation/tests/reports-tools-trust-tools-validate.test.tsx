import { assert, test } from 'vitest';
import { assistants, inspection, languagePacks, pairing, pluginPackage, plugins } from '../../app/ui/src/screens/tools/validate.ts';
import { channels, usage } from '../../app/ui/src/screens/tools/adapters/phone.ts';
import { app, draft } from '../../app/ui/src/screens/tools/adapters/smallapps.ts';
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

test('assumed other-lane replies are checked into view types', () => {
  invalid(() => usage({ month: 'Oct', sent: 1, budget: 40 }));
  invalid(() => channels({ relay: 'maybe', testMode: false, channels: [] }));
  invalid(() => channels({ relay: 'available', testMode: false, channels: [{ id: 'mail', on: true, address: null, verified: false, agreedOn: null, costMinor: '0.5' }] }));
  invalid(() => draft({ draftId: '', title: 't', uses: { calculations: [], actions: [] }, refused: null }));
  const base = { id: 'a', title: 't', state: 'made', madeFrom: 'l', madeOn: '2026-10-01', uses: { calculations: [], actions: [] }, textRemoved: false };
  assert.equal(app({ ...base, cards: [{ kind: 'metric', title: '<script>', figure: { kind: 'missing', missing: 'withheld' } }] }).cards[0]!.title, '<script>');
  invalid(() => app({ ...base, cards: [{ kind: 'html', title: 'x', html: '<b>x</b>' }] }));
  invalid(() => app({ ...base, cards: [{ kind: 'metric', title: 'x', figure: { kind: 'money', exact: '10', receiptId: '' } }] }));
});
