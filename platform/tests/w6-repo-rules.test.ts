import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { inspectFixtureSource, inspectRepository, inspectUiSource } from '../../scripts/w6-rules.mjs';

// Samples are composed at runtime; this test never stores a complete provider-shaped key in source.
const samples = [
  ['OpenAI', ['sk', '-'].join('') + 'a'.repeat(40)],
  ['Anthropic', ['sk', '-ant-'].join('') + 'b'.repeat(40)],
  ['GitHub', ['ghp', '_'].join('') + 'c'.repeat(36)],
  ['GitHub', ['github', '_pat_'].join('') + 'd'.repeat(70)],
  ['Telegram', '123456789' + ':' + 'e'.repeat(35)],
  ['Razorpay', ['rzp', '_test_'].join('') + 'f'.repeat(14)],
];

test('wave6 rule catches browser language reads, including brackets, optional chains and destructuring', () => {
  for (const text of [
    'const country = navigator.language;', 'const country = navigator?.languages[0];',
    "const country = window.navigator['language'];", "const country = globalThis['navigator'][`languages`];",
    'const { language: country } = navigator;', 'const nav = navigator; const country = nav.language;',
  ]) assert.deepEqual(inspectUiSource(text), ['browser-language-read']);
  for (const text of ['// navigator.language is not a country', 'const language = owner.language;', 'const country = Intl.DateTimeFormat().resolvedOptions().timeZone;', "const label = 'navigator.language';"])
    assert.deepEqual(inspectUiSource(text), []);
});

test('wave6 fixture rule catches complete provider keys without revealing any value', () => {
  for (const [provider, value] of samples) {
    const found = inspectFixtureSource('const credential = ' + JSON.stringify(value) + ';');
    assert.deepEqual(found, [provider]);
    assert.ok(!JSON.stringify(found).includes(value));
    assert.deepEqual(inspectFixtureSource(JSON.stringify({ credential: value }), 'fixture.json'), [provider]);
    assert.deepEqual(inspectFixtureSource('const credential = `Bearer ' + value + ' ${suffix}`;'), [provider]);
  }
});

test('wave6 fixture rule ignores regex definitions, comments and runtime constructions', () => {
  const value = samples[0][1];
  for (const source of ['// ' + value, 'const matcher = /' + value + '/;', 'const value = ' + JSON.stringify(value.slice(0, 2)) + ' + ' + JSON.stringify(value.slice(2)) + ';', 'const value = `prefix ${input}`;', "const value = 'fixture-password';"])
    assert.deepEqual(inspectFixtureSource(source), []);
});

test('wave6 repository source and fixture invariants hold', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  assert.deepEqual(inspectRepository(root), []);
});
