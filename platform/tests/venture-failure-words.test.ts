// Failures in plain words (Ink v2 wave 4, 4F2; catalogue O14). A fixed table by kind gives one sentence and, only when
// the owner must act, one fix: the month's AI limit used up, not signed in, offline, too long for the AI in one go, out
// of date. Only offline is transient, and nothing is done again on its own. An error Chausar does not know is never
// echoed. A connector error says what happens next; a missing permission keeps the action as a flagged draft. The run
// sheet carries "How to fix it" (RunDetail.fix). No network: the real model port runs on a fake transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import type { ModelTransport, VentureDeps } from '../runtime/venture/contracts.ts';
import { connectorAction, FAILURE_TABLE, failureWords, fixFor, type FailureKind } from '../runtime/venture/delivery/failure-words.ts';
import { createModelPort, handlers as modelHandlers, PRESETS } from '../runtime/venture/models/index.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { owner as portOwner, realPortEnv, wordsTask as portWords } from './venture-real-port-env.ts';
import { TrustService } from '../runtime/trust.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { approve, code, getRun, owner, READ, DONE, record, setup, startRun } from './venture-run-controls-env.ts';

const AT = '2026-10-16T10:00:00.000Z';
const words = (code: string, message: string, tool?: string, cause?: string) => failureWords({ code, message, ...(cause ? { cause } : {}) }, { at: AT, dateOrder: 'day-month-year', ...(tool ? { tool } : {}) });

test('failure words: one sentence and a fix for each kind; only offline is transient; an unknown error has no fix', () => {
  const kinds = Object.keys(FAILURE_TABLE) as FailureKind[];
  assert.deepEqual(kinds.sort(), ['allowance-spent', 'not-signed-in', 'offline', 'out-of-date', 'too-long', 'unknown']);
  for (const kind of kinds) {
    const row = FAILURE_TABLE[kind];
    assert.equal(row.line.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2, true, kind);
    assert.equal(row.transient, kind === 'offline', kind);
    assert.equal(row.fix === null, kind === 'unknown', kind);
    assert.ok(Object.isFrozen(row));
  }
  assert.ok(Object.isFrozen(FAILURE_TABLE));
});

test('failure words: an AI failure is placed by its code and Chausar\'s own words', () => {
  assert.deepEqual(words('SPEND_CAP', 'This could take this month past your limit.'), {
    kind: 'allowance-spent', line: "This month's AI limit is used up.", fix: 'Raise it in Money, or wait until 1 Nov.', fixKind: 'raise-limit', transient: false,
  });
  assert.equal(words('BUDGET_REACHED', 'This call could take Claude past your monthly limit.')!.kind, 'allowance-spent');
  assert.equal(failureWords({ code: 'SPEND_CAP', message: 'x' }, { at: '2026-12-31T23:00:00.000Z', dateOrder: 'month-day-year' })!.fix, 'Raise it in Money, or wait until Jan 1.');
  assert.equal(words('MODEL_KEY_MISSING', 'Enter your key again. Chausar keeps keys in memory only.')!.kind, 'not-signed-in');
  assert.equal(words('MODEL_FAILED', 'Anthropic refused your key. Check it and connect again.')!.kind, 'not-signed-in');
  assert.equal(words('CLI_UNAVAILABLE', 'Claude Code 2.1.4 is on this computer but not signed in. Run claude and sign in.')!.line, 'Your AI is not signed in.');
  // Offline is known by the transport's own class (never connected), not by the words of its message.
  assert.deepEqual(words('MODEL_FAILED', 'Chausar could not reach the model provider. Nothing was sent.', undefined, 'not-connected'), {
    kind: 'offline', line: 'Your computer seems offline, so nothing was sent.', fix: 'Run it again once you are back online.', fixKind: 'run-again-online', transient: true,
  });
  assert.equal(words('MODEL_FAILED', 'Chausar could not reach the model provider. Nothing was sent.')!.kind, 'unknown', 'the same words without the class are not offline');
  assert.equal(words('MODEL_INCOMPLETE', 'The model ran out of room before it finished. Nothing was retried.')!.kind, 'too-long');
  assert.equal(words('CLI_FLAGS_UNSUPPORTED', 'Codex 0.40 does not know a flag Chausar sends.', 'Codex')!.line, 'Codex is out of date for Chausar.');
  const unknown = words('MODEL_FAILED', 'Anthropic returned an error (HTTP 529). Chausar did not retry it.')!;
  assert.deepEqual(unknown, { kind: 'unknown', line: "The AI service answered with an error Chausar doesn't know. Nothing was retried.", fix: null, fixKind: null, transient: false });
  assert.equal(words('TOOL_FAILED', 'There is no file "f9".'), null, 'not an AI failure: its own words stand');
  // Fixes for what only the owner can clear on this computer.
  assert.equal(fixFor({ code: 'TOOL_FAILED', message: 'not run: ffmpeg not found' }, { at: AT, dateOrder: 'day-month-year' }), 'Install ffmpeg, or turn off the finishing check, then run again.');
  assert.equal(fixFor({ code: 'TOOL_FAILED', message: 'ffmpeg was not found on this computer.' }, { at: AT, dateOrder: 'day-month-year' }), 'Install ffmpeg, or turn off the finishing check, then run again.');
  assert.equal(fixFor({ code: 'TIER_UNAVAILABLE', message: 'Needs Docker Desktop.' }, { at: AT, dateOrder: 'day-month-year' }), 'Set up Docker Desktop and start it, then run again.');
  assert.equal(fixFor({ code: 'TOOL_FAILED', message: 'There is no file "f9".' }, { at: AT, dateOrder: 'day-month-year' }), null, 'nothing for the owner to do');
});

test('failure words: an error the AI service sent is never echoed, from the real model port', async () => {
  const store = new VentureTestStore();
  const clock = () => new Date(AT);
  const raw = 'INTERNAL-TRACE upstream_shard=7f3a token=abc';
  const transport: ModelTransport = { replay: false, async http() { return { status: 500, body: JSON.stringify({ error: { message: raw } }) }; }, async process() { return { exitCode: 1, stdout: '' }; } };
  const values = new Map<string, string>();
  const secrets = { get: (name: string) => values.get(name) ?? null, set: (name: string, value: string) => { values.set(name, value); }, delete: (name: string) => { values.delete(name); }, has: (name: string) => values.has(name), clear: () => values.clear() };
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' } as Parameters<typeof createModelPort>[0]);
  const deps = { store, clock, models: port, services: { trust: new TrustService(store) }, secrets, host: 'test', demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as never, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as never), { create: true });
  const spec = PRESETS.find(item => item.id === 'anthropic-haiku-5-5')!;
  await (modelHandlers as Record<string, (d: VentureDeps, c: typeof owner, p: unknown) => Promise<unknown>>)['venture.models.connect'](deps, owner, { presetId: spec.id, consentDigest: spec.consentDigest, apiKey: ['sk', 'ant', 'api03', 'testtesttesttesttesttest'].join('-') });
  const error = await port.generate(owner, {
    purpose: 'interview', instructions: 'Write one short question.', input: {}, schemaName: 'test-words',
    schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string' } } },
    validate: value => value, containsClientData: false, maxOutputTokens: 256,
  }).then(() => null, (thrown: unknown) => thrown as ChausarError);
  assert.ok(error);
  assert.ok(!error.message.includes(raw) && !error.message.includes('7f3a'), 'the port words it in Chausar\'s words');
  const said = failureWords({ code: error.code, message: error.message }, { at: AT, dateOrder: 'day-month-year' })!;
  assert.equal(said.kind, 'unknown');
  assert.equal(said.line, "The AI service answered with an error Chausar doesn't know. Nothing was retried.");
  assert.ok(!JSON.stringify(said).includes('7f3a'));
});

test('offline: the transport marks a call that never connected, and the real port keeps that class on the call record', async () => {
  const { defaultModelTransport } = await import('../runtime/venture/models/transport.ts');
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as typeof fetch;
  let thrown: any = null;
  try {
    thrown = await defaultModelTransport().http({ url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {}, body: '{}', timeoutMs: 2000, purpose: 'interview' }).then(() => null, error => error);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(thrown?.code, 'MODEL_FAILED');
  assert.equal(thrown?.details?.cause, 'not-connected');
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  env.env.answer = () => { throw thrown; };
  await assert.rejects(env.port.generate(portOwner, portWords('interview')), code('MODEL_FAILED'));
  const call = listRecords(env.store.read(), 'venture-model-call').at(-1)!;
  assert.deepEqual(call.error, { code: 'MODEL_FAILED', message: thrown.message, cause: 'not-connected' });
  assert.equal(failureWords(call.error!, { at: AT, dateOrder: 'day-month-year' })!.kind, 'offline');
});

test('connector errors say what happens next; a missing permission keeps the action as a flagged draft, never dropped', () => {
  const text = 'Hello Asha, your September books are ready.';
  const duplicate = connectorAction({ status: 409 }, text, 'Zoho Books');
  assert.equal(duplicate.action, 'adopt');
  assert.match(duplicate.line, /looks it up and uses that one/);
  assert.equal(connectorAction({ code: 'ALREADY_DONE' }, text, 'Razorpay').action, 'success');
  assert.equal(connectorAction({ code: 'PAST_DEADLINE' }, text, 'Razorpay').action, 'person');
  assert.equal(connectorAction({ status: 410 }, text, 'Razorpay').action, 'person');
  const denied = connectorAction({ status: 403 }, text, 'Gmail');
  assert.deepEqual(denied, {
    action: 'flagged-draft', line: 'Chausar is missing permission to do this on Gmail, so it was kept as a draft for you.',
    fix: 'Give Gmail that permission, then send the draft.', draft: { text, flag: 'Needs permission on Gmail' },
  });
  assert.equal(connectorAction({ code: 'INSUFFICIENT_SCOPE' }, text, 'Gmail').action, 'flagged-draft');
  const unknown = connectorAction({ status: 502, code: 'UPSTREAM' }, text, 'Gmail');
  assert.deepEqual(unknown, { action: 'fail', line: "The service answered with an error Chausar doesn't know. Nothing was retried.", fix: null });
});

test('run sheet: How to fix it on a failed run whose AI is not signed in; none when the owner has nothing to do', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, DONE]);
  const message = 'Enter your key again. Chausar keeps keys in memory only.';
  // As the real port does: the call is claimed, its failure is kept on its record, then the error is thrown.
  (env.models as unknown as { runPreview: unknown }).runPreview = async (_ctx: unknown, callId: string) => {
    await env.store.update(state => {
      const call = state.conversations.find(item => item?.id === callId);
      if (call) { call.status = 'failed'; call.error = { code: 'MODEL_KEY_MISSING', message }; }
    });
    throw new ChausarError('MODEL_KEY_MISSING', message);
  };
  await assert.rejects(approve(env, run), code('MODEL_KEY_MISSING'));
  assert.equal(record(env, run.id).status, 'failed');
  const detail = await getRun(env, run.id);
  assert.equal(detail.error, message, 'what went wrong stays the engine\'s own words');
  assert.equal(detail.fix, 'Sign in again under Connections, Your AI, then run it again.');
  // The plain sentence and the codes the screen needs for its own words (Hindi too).
  assert.deepEqual(detail.failure, { kind: 'not-signed-in', line: 'Your AI is not signed in.' });
  assert.equal(detail.fixKind, 'sign-in');

  const other = await setup();
  const fine = await startRun(other, [READ, DONE]);
  assert.equal((await getRun(other, fine.id)).fix, undefined);
});
