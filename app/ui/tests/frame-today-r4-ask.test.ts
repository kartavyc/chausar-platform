import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEngine, registerFakeMethods } from '../src/bridge/fake.ts';
import { fakeReading, registerAskLineFixtures } from '../src/bridge/fixtures/ask-line.ts';
import {
  isVoiceConfirm, isVoiceHeard, isVoiceStatus, readAskAbout, readAskSearch, readAskSuggest, readMemoryLine, readRecordsSearch, readVoiceSpeak, readVoiceStart,
} from '../src/bridge/voice-contract.ts';
import { createSuggestionSource, isTelling, mergeSuggestions, SUGGESTION_MAX, type HostSuggestion } from '../src/host/ask-suggestions.ts';
import { createVoiceController, flipsOf, readBacksOf, type VoiceCapturePort, type VoiceSpeakerPort, type VoiceTake } from '../src/host/voice-controller.ts';
import { words } from '../src/text/lanes/frame-today.ts';

const names = () => [{ text: 'Books › Sources', address: { place: 'books' as const, sub: 'sources' } }, { text: 'Today', address: { place: 'today' as const } }];

test('telling, not asking: a first-person statement with no question word or mark', () => {
  for (const text of ['our year starts in April', 'Our financial year starts in April.', 'we close the books on the 5th', 'हमारा साल अप्रैल से शुरू होता है']) assert.equal(isTelling(text), true, text);
  for (const text of ['what did we bill last month?', 'our sales last month?', 'show sales', 'billed last month', 'how much did we receive', 'kitna mila', 'our']) assert.equal(isTelling(text), false, text);
});

test('suggestions take turns across kinds and never pass five', () => {
  const item = (kind: HostSuggestion['kind'], i: number): HostSuggestion => ({ id: `${kind}:${i}`, text: `${kind} ${i}`, kind, target: { kind: 'place', address: { place: 'today' } } });
  const merged = mergeSuggestions([[0, 1, 2, 3].map(i => item('calculation', i)), [0, 1].map(i => item('customer', i)), [item('place', 0)], []]);
  assert.equal(merged.length, SUGGESTION_MAX);
  assert.deepEqual(merged.map(m => m.kind), ['calculation', 'customer', 'place', 'calculation', 'customer']);
});

test('suggestions are local engine reads: askx.suggest once, records.search, askx.search; nothing to a model', async () => {
  const fixtures = registerAskLineFixtures();
  try {
    const engine = createFakeEngine();
    const source = createSuggestionSource(engine, names);
    assert.deepEqual(await source.suggest('  '), []);
    const kiran = await source.suggest('kiran');
    assert.deepEqual(kiran.map(s => [s.kind, s.text]), [['customer', 'Kiran Retail Demo'], ['saved', 'Received from Kiran Retail Demo'], ['customer', 'Sunrise Kirana Demo']]);
    const money = await source.suggest('mon');
    assert.ok(money.some(s => s.kind === 'calculation' && s.text === 'Money received'));
    const books = await source.suggest('sources');
    assert.deepEqual(books.find(s => s.kind === 'place')?.target, { kind: 'place', address: { place: 'books', sub: 'sources' } });
    assert.equal(engine.calls.filter(c => c === 'askx.suggest').length, 1);
    assert.ok(!engine.calls.some(c => c.startsWith('models.') || c.startsWith('conversation')), 'no model request');
  } finally { fixtures.undo(); }
});

test('a family that is absent adds nothing to the suggestions', async () => {
  const engine = createFakeEngine();
  const source = createSuggestionSource(engine, names);
  assert.deepEqual((await source.suggest('books')).map(s => s.kind), ['place']);
});

test('replies are validated before they are drawn', () => {
  assert.equal(readAskSuggest({ suggestions: [{ operationId: 'x', label: 'X' }] }), null);
  assert.equal(readRecordsSearch({ records: [{ id: 'bad id!', kind: 'customer', name: 'A' }] }), null);
  assert.deepEqual(readRecordsSearch({ records: [{ id: 'c1', kind: 'supplier', name: 'S' }, { id: 'c2', kind: 'customer', name: null }] }), [{ id: 'c2', name: 'c2' }]);
  assert.equal(readAskSearch({ groups: [{ kind: 'saved', hits: [{ id: 1, text: 'x' }] }] }), null);
  assert.equal(readMemoryLine({ id: 'm1', text: 't', kind: 'gossip', status: 'proposed', source: 'told-by-owner' }), null);
  assert.equal(readAskAbout({ label: '', ref: { kind: 'customer', id: 'c1' } }), null);
  assert.equal(readAskAbout({ label: 'Kiran', ref: { kind: 'Customer!', id: 'c1' } }), null);
  assert.deepEqual(readAskAbout({ label: ' Kiran Retail Demo ', ref: { kind: 'customer', id: 'c1' } }), { label: 'Kiran Retail Demo', ref: { kind: 'customer', id: 'c1' } });
  assert.equal(isVoiceStatus({ enabled: true, mode: 'loud', send: 'samples', localOnly: false, provider: null, live: null, speaking: null, usage: { month: '2026-10', providers: [], totals: { minutesMs: 0, costMinor: '0' } } }), false);
  assert.equal(readVoiceStart({ sessionId: 's1', capture: 'telepathy', capMs: 1 }), null);
  assert.equal(isVoiceHeard({ sessionId: 's1', heard: 'x', understood: null, needsConfirmation: true, words: 'x' }), false);
  assert.equal(isVoiceHeard({ sessionId: 's1', heard: null, understood: null, needsConfirmation: true, words: 'Not sure what was said.' }, 's2'), false);
  assert.equal(isVoiceConfirm({ confirmationId: 'c', text: 'x', digest: 'a'.repeat(64) }, 'b'.repeat(64)), false);
  assert.equal(readVoiceSpeak({ utteranceId: 'u', language: 'en', segments: [{ text: 1 }] }), null);
});

function fakeCapture(said: string | null): VoiceCapturePort & { began: string[] } {
  const began: string[] = [];
  let on = false;
  return {
    began,
    begin(capture, _language, onWords) { began.push(capture); on = true; if (said) onWords(said.split(' ')[0]!); return true; },
    async end(): Promise<VoiceTake | null> { if (!on) return null; on = false; return said === null ? null : { transcript: said, durationMs: 1200 }; },
    cancel() { on = false; },
  };
}
const speaker = (): VoiceSpeakerPort & { said: string[][]; stopped: number } => {
  const s = { said: [] as string[][], stopped: 0, speak(texts: readonly string[]) { s.said.push([...texts]); return true; }, stop() { s.stopped++; } };
  return s;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('voice: a hold is heard, every amount is read back, and nothing is confirmed before Yes and Ask this', async () => {
  const fixtures = registerAskLineFixtures({ enabled: true, mode: 'browser' });
  try {
    const engine = createFakeEngine();
    const voice = createVoiceController(engine, fakeCapture('do lakh nahi mila'), speaker(), () => 'hi');
    await voice.refresh();
    assert.equal(voice.snapshot().status.kind, 'ready');
    voice.start(); await settle(); await settle();
    assert.equal(voice.snapshot().phase.kind, 'listening');
    await voice.stop();
    const heard = voice.snapshot().phase;
    assert.equal(heard.kind, 'heard');
    if (heard.kind !== 'heard') return;
    assert.equal(heard.text, 'do lakh nahi mila');
    // No rupees or paise were said: the number is shown back as its words, never as money.
    assert.deepEqual(heard.readBacks, [{ kind: 'number', text: 'do lakh' }]);
    assert.deepEqual(heard.flips, ['nahi']);
    // Not yet answered: Ask this does nothing and nothing is confirmed.
    assert.equal(await voice.confirm(), null);
    assert.ok(!engine.calls.includes('voice.confirm'));
    voice.answer(0, true);
    assert.equal(await voice.confirm(), 'do lakh nahi mila');
    assert.ok(engine.calls.includes('voice.confirm'));
    assert.equal(voice.snapshot().phase.kind, 'idle');
  } finally { fixtures.undo(); }
});

test('voice: only rupees or paise are read back as money; confirm asks with the text seen and refuses other words', async () => {
  const number = (unit: 'rupees' | 'paise' | null, paise: string | null) => ({ text: 'do lakh', integer: '200000', unit, paise, display: '2,00,000' });
  const reading = (numbers: unknown[]) => ({ sessionId: 's', heard: 'x', needsConfirmation: true as const, words: 'x', understood: { ...(fakeReading('x') as object), numbers } as never });
  assert.deepEqual(readBacksOf(reading([number(null, null)])), [{ kind: 'number', text: 'do lakh' }]);
  assert.deepEqual(readBacksOf(reading([number('rupees', '20000000')])), [{ kind: 'amount', paise: '20000000' }]);
  assert.deepEqual(readBacksOf(reading([number('paise', '200000')])), [{ kind: 'amount', paise: '200000' }]);

  const fixtures = registerAskLineFixtures({ enabled: true, mode: 'browser' });
  const sent: Record<string, unknown>[] = [];
  let undo = () => {};
  try {
    const engine = createFakeEngine();
    const voice = createVoiceController(engine, fakeCapture('paanch hazaar rupaye mila'), null, () => 'hi');
    voice.start(); await settle(); await settle(); await voice.stop();
    const p = voice.snapshot().phase;
    assert.ok(p.kind === 'heard');
    if (p.kind !== 'heard') return;
    undo = registerFakeMethods('voice', { confirm: payload => { sent.push({ ...payload }); return { confirmationId: 'voice_confirmation_x', text: 'das hazaar rupaye mila', digest: p.digest }; } });
    voice.answer(0, true);
    assert.equal(await voice.confirm(), null, 'other words are never used');
    assert.equal(sent[0]?.['text'], p.text, 'the text the person saw is sent');
    assert.deepEqual(voice.snapshot().phase, { kind: 'failed', code: 'UNDERSTOOD_CHANGED' });
  } finally { undo(); fixtures.undo(); }
});

test('voice: live false is not live; live true or the live details object is', () => {
  const start = { sessionId: 's1', capture: 'browser-transcript', capMs: 1000 };
  assert.equal(readVoiceStart({ ...start, live: false })?.live, false);
  assert.equal(readVoiceStart(start)?.live, false);
  assert.equal(readVoiceStart({ ...start, live: null })?.live, false);
  assert.equal(readVoiceStart({ ...start, live: true })?.live, true);
  assert.equal(readVoiceStart({ ...start, live: { clientSecret: 'x', expiresAt: '2026-10-15T00:00:00.000Z' } })?.live, true);
  assert.equal(readVoiceStart({ ...start, capture: 'live-session' })?.live, true);
});

test('voice: could not hear, voice off, local only, and not built', async () => {
  let fixtures = registerAskLineFixtures({ enabled: true, mode: 'local' });
  try {
    const voice = createVoiceController(createFakeEngine(), fakeCapture(null), null, () => 'en');
    voice.start(); await settle(); await settle(); await voice.stop();
    assert.deepEqual(voice.snapshot().phase, { kind: 'unsure', words: '' });
  } finally { fixtures.undo(); }
  fixtures = registerAskLineFixtures({});
  try {
    const voice = createVoiceController(createFakeEngine(), fakeCapture('x'), null, () => 'en');
    await voice.refresh();
    const status = voice.snapshot().status;
    assert.ok(status.kind === 'ready' && !status.value.enabled, 'off by default');
    voice.start(); await settle(); await settle();
    assert.equal(voice.snapshot().phase.kind, 'off');
  } finally { fixtures.undo(); }
  fixtures = registerAskLineFixtures({ enabled: true, mode: 'paid', localOnly: true });
  try {
    const voice = createVoiceController(createFakeEngine(), fakeCapture('x'), null, () => 'en');
    voice.start(); await settle(); await settle();
    assert.equal(voice.snapshot().phase.kind, 'local-only');
  } finally { fixtures.undo(); }
  const voice = createVoiceController(createFakeEngine(), fakeCapture('x'), null, () => 'en');
  await voice.refresh();
  assert.equal(voice.snapshot().status.kind, 'not-built');
  voice.start(); await settle(); await settle();
  assert.equal(voice.snapshot().phase.kind, 'not-built');
});

test('voice: a dropped note, a paid approval, and speaking from the receipt', async () => {
  const fixtures = registerAskLineFixtures({ enabled: true, mode: 'paid', approval: true });
  try {
    const engine = createFakeEngine();
    const say = speaker();
    const voice = createVoiceController(engine, fakeCapture('x'), say, () => 'en');
    await voice.dropNote({ audioBase64: Buffer.from('paanch hazaar rupaye').toString('base64'), mimeType: 'audio/webm', durationMs: 900 });
    const p = voice.snapshot().phase;
    assert.ok(p.kind === 'heard' && p.readBacks[0]?.kind === 'amount' && p.readBacks[0].paise === '500000');
    voice.start(); await settle(); await settle();
    assert.deepEqual(voice.snapshot().phase, { kind: 'approval', costCapMinor: '200' });
    await voice.speak('receipt_demo', 'en');
    assert.equal(voice.snapshot().speak.kind, 'speaking');
    assert.deepEqual(say.said[0], ['The figure on this receipt is', '25 lakh 36 thousand 850 rupees']);
    voice.stopSpeaking(); await settle();
    assert.equal(voice.snapshot().speak.kind, 'quiet');
    assert.ok(engine.calls.includes('voice.stopSpeaking'));
  } finally { fixtures.undo(); }
});

test('voice: dates are read back too', async () => {
  const reading = fakeReading('our year starts on 1 April');
  const heard = { sessionId: 's', heard: 'x', understood: reading as never, needsConfirmation: true as const, words: 'x' };
  assert.deepEqual(readBacksOf(heard).filter(r => r.kind === 'date'), [{ kind: 'date', text: '1 April' }]);
  assert.deepEqual(flipsOf(heard), []);
});

test('cash by voice: one hold becomes text through voice.start and voice.stop', async () => {
  const fixtures = registerAskLineFixtures({ enabled: true, mode: 'local' });
  try {
    const engine = createFakeEngine();
    const listen = createVoiceController(engine, fakeCapture('do lakh'), null, () => 'en').listenOnce();
    listen.start();
    assert.equal(await listen.stop(), 'do lakh');
    assert.deepEqual(engine.calls.filter(c => c.startsWith('voice.')), ['voice.start', 'voice.stop']);
  } finally { fixtures.undo(); }
});

test('the new words are in English and Hindi', () => {
  assert.deepEqual(Object.keys(words.hi).sort(), Object.keys(words.en).sort());
  assert.ok(Object.keys(words.en).length > 20);
});
