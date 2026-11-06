import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFor, connectPair, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const TEXT = 'I live in the United Kingdom and offer bookkeeping to clients in India.';
const QUOTE = 'I live in the United Kingdom';
const ask = (engine: Awaited<ReturnType<typeof engineFor>>['engine'], text = TEXT) => engine.request('venture.country.suggest', { text });

test('country suggestion is honest without connected AI and creates no vault', async t => {
  const { engine } = await engineFor(t);
  assert.deepEqual(await ask(engine), { country: null, evidence: null, source: 'not-connected' });
  assert.equal((await engine.request('workspace.status', {})).open, false);
});

test('AI reads owner location before and after vault creation without changing the business country', async t => {
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', { countryCode: 'GB', evidence: QUOTE }, [TEXT, 'client', 'location'])] });
  await connectPair(engine);
  const first = await ask(engine);
  assert.equal(first.country.code, 'GB');
  assert.equal(first.country.currency, 'GBP');
  assert.equal(first.evidence, QUOTE);
  assert.equal(first.source, 'ai');
  assert.equal((await engine.request('workspace.status', {})).open, false);
  await engine.request('workspace.create', { name: 'Synthetic country example', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Bookkeeping for small cafes', countryCode: 'IN', workingName: 'Synthetic country example' });
  const second = await ask(engine);
  assert.equal(second.country.code, 'GB');
  const current = await engine.request('venture.get', {});
  assert.equal(current.venture.country.code, 'IN');
});

test('client location alone has no owner country inference', async t => {
  const text = 'I offer bookkeeping to clients in Canada and India.';
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', { countryCode: null, evidence: null }, [text, 'client'])] });
  await connectPair(engine);
  assert.deepEqual(await ask(engine, text), { country: null, evidence: null, source: 'ai' });
});

test('model country suggestions require a supported country and evidence copied from the owner sentence', async t => {
  for (const value of [{ countryCode: 'ZZ', evidence: QUOTE }, { countryCode: 'GB', evidence: 'The owner lives in London.' }, { countryCode: 'GB', evidence: null }]) {
    const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', value, [TEXT])] });
    await connectPair(engine);
    await assert.rejects(ask(engine), { code: 'MODEL_OUTPUT_REJECTED' });
  }
});

test('country suggestion is owner-only, inside the app, and rejects files or other payload fields', async t => {
  const { engine } = await engineFor(t);
  await assert.rejects(engine.requestAs({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' }, 'venture.country.suggest', { text: TEXT }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(engine.requestAs({ memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' }, 'venture.country.suggest', { text: TEXT }), { code: 'FORBIDDEN' });
  await assert.rejects(engine.request('venture.country.suggest', { text: TEXT, attachment: 'not sent' }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('country suggestion exposes model failures and stays unavailable on the hosted tier', async t => {
  const { engine } = await engineFor(t);
  await connectPair(engine);
  await assert.rejects(ask(engine), { code: 'FIXTURE_MISSING' });
  const hosted = await engineFor(t);
  hosted.engine.options.venture!.host = 'hosted-web';
  await assert.rejects(ask(hosted.engine), { code: 'HOSTED_NOT_AVAILABLE' });
});
