// Mock providers and typed mock tools (Ink v2 wave 4, package 4J11, catalogue H33), for tests and practice only. A mock
// payment link, mail or posting provider runs the real checks on what it is asked to do (posting: exactly the checks
// build/posting.ts runs before it proposes a post) and goes through the real journal (described, approved, then
// applied, rejected or outcome_unknown), and failNext() makes its next call fail in a chosen way. A typed mock tool (a
// real tool's fields and a hand-written result) serves rehearsal and shadow runs. Where a mock may run comes from the
// test host or the run's own tool environment, never from what a caller says. Every mock says it is one, proves
// nothing, never reaches the network, and is refused on a real run (MOCK_REAL_RUN).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import type { JournalRecord, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { journalled, type ProposeInput } from '../runtime/venture/journal/index.ts';
import { MOCK_LABEL, MOCK_TOOL_NOTE, mockTool } from '../runtime/venture/delivery/harness/mocks.ts';
import { mockProvider } from '../runtime/venture/delivery/harness/mock-providers.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { applyTurn, DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { defaultPolicyContext } from '../runtime/venture/policy/ladder.ts';
import { claimBacked } from '../runtime/venture/delivery/harness/claims.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const NOW = '2026-10-26T10:00:00.000Z';

async function business(host: VentureDeps['host'] = 'test') {
  const store = new VentureTestStore();
  let netCalls = 0;
  const deps = {
    store, clock: () => new Date(NOW), host,
    // The net guard's stub: anything that tried to reach a network through the engine's ports would be counted here.
    net: { resolve: async () => { netCalls += 1; return []; }, send: async () => { netCalls += 1; throw new Error('no network in tests'); } },
  } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Social posts for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
    serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  return { store, deps, netCalls: () => netCalls };
}
const proposal = (subject: string, line: string): ProposeInput => ({
  action: 'connector.write', subject, target: 'A practice provider', actionDigest: createHash('sha256').update(subject).digest('hex'), line, operation: 'send-deliverable',
});
const entry = (deps: VentureDeps, subject: string) => listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.subject === subject) as JournalRecord;
const states = (record: JournalRecord) => record.journal.map(step => step.state);
const test_ = (deps: VentureDeps) => ({ for: 'test' as const, deps });

/** Counts every fetch made while a test body runs. */
async function noFetch<T>(body: () => Promise<T>): Promise<{ value: T; fetches: number }> {
  const saved = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in tests'); }) as typeof fetch;
  try { return { value: await body(), fetches }; } finally { globalThis.fetch = saved; }
}

// ---------------------------------------------------------------------------
// 1. Mock providers: the real checks, the real journal, failNext()
// ---------------------------------------------------------------------------

test('mock providers: payment link and mail run the real checks on what they are asked to do, and say they are mocks', async () => {
  const { deps } = await business();
  const link = mockProvider('payment-link', test_(deps));
  const mail = mockProvider('mail', test_(deps));
  for (const provider of [link, mail, mockProvider('posting', test_(deps))]) {
    assert.equal(provider.mock, true);
    assert.equal(provider.label, MOCK_LABEL);
  }
  assert.match(MOCK_LABEL, /nothing/i);
  // Payment link: a positive whole amount in minor units, a currency code, a purpose in words, a payer address if any.
  assert.doesNotThrow(() => link.validate({ amountMinor: '250000', currency: 'INR', purpose: 'September books', payer: 'owner@cafe.example' }));
  for (const bad of [{ amountMinor: '0' }, { amountMinor: '-5' }, { amountMinor: '12.50' }, { amountMinor: 2500 }, { currency: 'rupees' }, { purpose: '' }, { payer: 'not an address' }, { extra: true }]) {
    assert.throws(() => link.validate({ amountMinor: '250000', currency: 'INR', purpose: 'September books', ...bad }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  // Mail: one real address, a subject on one line, a body of words.
  assert.doesNotThrow(() => mail.validate({ to: 'client@cafe.example', subject: 'Your September books', body: 'They are attached.' }));
  for (const bad of [{ to: 'nobody' }, { to: '=cmd@x.example' }, { subject: 'two\nlines' }, { body: '' }]) {
    assert.throws(() => mail.validate({ to: 'client@cafe.example', subject: 'Your September books', body: 'They are attached.', ...bad }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
});

test('mock posting: exactly the checks posting.ts runs before a post (a draft\'s post by id, the channel hold, the draft binding)', async () => {
  const { deps } = await business();
  const post = mockProvider('posting', test_(deps));
  const draft = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'LinkedIn: Our September guide is out.']);
  assert.equal(post.validate({ connectorId: 'x', draftId: draft.id }).text, 'Fresh pastries at 8.', 'the text is the draft\'s own line, never free text');
  assert.throws(() => post.validate({ connectorId: 'x', text: 'Anything I like' }), code('INVALID_VENTURE_REQUEST'), 'no free text');
  assert.throws(() => post.validate({ connectorId: 'myspace', draftId: draft.id }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => post.validate({ connectorId: 'x', draftId: 'delivery_missing' }), 'a draft that is not there');
  const unreviewed = await seedPostDraft(deps, ['X: Not reviewed yet.'], { status: 'ready-for-review', verdict: null });
  assert.throws(() => post.validate({ connectorId: 'x', draftId: unreviewed.id }), 'a draft the owner has not accepted');
  const posted = await post.send({ connectorId: 'x', draftId: draft.id });
  assert.match(posted.url, /^practice:\/\/posting\//);
  assert.equal(posted.label, MOCK_LABEL);
  // A check the platform showed holds the channel: the practice post is refused the same way a real one is.
  await ventureAction(deps, owner, 'approve', 'seed.hold', tx => tx.put({
    ...tx.base('venture-channel-hold'), connectorId: 'x', site: 'x.com', cause: 'challenge' as const, line: 'X showed a security check.', until: null, postId: null, clearedAt: null, clearedBy: null,
  } as any));
  assert.throws(() => post.validate({ connectorId: 'x', draftId: draft.id }), code('CHANNEL_CHALLENGED'));
});

test('mock providers: through the real journal, applied; failNext makes the next call not sent, unknown or an error, once each', async () => {
  const { deps, netCalls } = await business();
  const mail = mockProvider('mail', test_(deps));
  const message = { to: 'client@cafe.example', subject: 'Your September books', body: 'They are attached.' };
  const { value, fetches } = await noFetch(async () => {
    const done = await journalled(deps, owner, proposal('mail:1', 'Send the September books.'), mail.effect(message));
    assert.deepEqual(states(entry(deps, 'mail:1')), ['described', 'approved', 'applied']);
    assert.equal(done.value!.mock, true);
    assert.match(done.value!.url, /^practice:\/\//, 'a mock address can never be opened on the web');
    assert.match(entry(deps, 'mail:1').outcome!.line, /^Practice:/);

    mail.failNext('not-sent');
    await journalled(deps, owner, proposal('mail:2', 'Send again.'), mail.effect(message));
    assert.equal(entry(deps, 'mail:2').state, 'rejected');

    mail.failNext('unknown');
    await journalled(deps, owner, proposal('mail:3', 'Send once more.'), mail.effect(message));
    assert.equal(entry(deps, 'mail:3').state, 'outcome_unknown', 'never run again on its own; the owner checks it');

    mail.failNext('error');
    await assert.rejects(journalled(deps, owner, proposal('mail:4', 'And again.'), mail.effect(message)));
    assert.equal(entry(deps, 'mail:4').state, 'rejected');

    // Each failure is used once: the next call works again.
    await journalled(deps, owner, proposal('mail:5', 'Last one.'), mail.effect(message));
    assert.equal(entry(deps, 'mail:5').state, 'applied');
    // A bad request is refused by the real checks before anything is journalled as sent.
    await assert.rejects(journalled(deps, owner, proposal('mail:6', 'Bad.'), mail.effect({ ...message, to: 'nobody' })), code('INVALID_VENTURE_REQUEST'));
    assert.notEqual(entry(deps, 'mail:6')?.state, 'applied');
    return mail.requests.map(item => item.state);
  });
  assert.deepEqual(value, ['sent', 'not-sent', 'unknown', 'failed', 'sent']);
  assert.equal(fetches, 0);
  assert.equal(netCalls(), 0, 'the net guard stub counts zero requests');
});

test('mock providers: a payment link moves created to paid once', async () => {
  const { deps } = await business();
  const link = mockProvider('payment-link', test_(deps));
  const made = await link.send({ amountMinor: '250000', currency: 'INR', purpose: 'September books' });
  assert.equal(made.status, 'created');
  assert.equal(link.pay(made.id).status, 'paid');
  assert.throws(() => link.pay(made.id), code('ALREADY_DECIDED'), 'a link is paid once');
  assert.throws(() => link.pay('nope'), code('INVALID_VENTURE_REQUEST'));
  link.failNext('error');
  await assert.rejects(link.send({ amountMinor: '100', currency: 'INR', purpose: 'Tip' }));
});

test('mock providers: where they may run is read from the run\'s tool environment or the test host, never from the caller', async () => {
  const { deps } = await business();
  const env = (runRef: ToolEnv['runRef'], posture?: 'shadow') => ({
    deps, runRef, policy: { context: { ...defaultPolicyContext(runRef), ...(posture ? { posture } : {}) } },
  }) as unknown as ToolEnv;
  assert.throws(() => mockProvider('mail', { for: 'practice', env: env({ kind: 'delivery', runId: 'run_1' }) }), code('MOCK_REAL_RUN'));
  assert.throws(() => mockProvider('mail', { for: 'practice', env: env({ kind: 'delivery', runId: 'run_1' }, 'shadow') }), code('MOCK_REAL_RUN'), 'a real order never gets a practice provider');
  assert.doesNotThrow(() => mockProvider('mail', { for: 'practice', env: env({ kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }) }));
  assert.throws(() => mockProvider('mail', { for: 'practice', runRef: { kind: 'rehearsal', scenarioId: 'x', episode: 0 } } as any), 'a runRef the caller names is not a tool environment');
  for (const host of ['desktop', 'local-web', 'hosted-web'] as const) {
    const real = await business(host);
    assert.throws(() => mockProvider('payment-link', test_(real.deps)), code('MOCK_REAL_RUN'), host);
  }
  assert.throws(() => mockProvider('wire-transfer' as any, test_(deps)), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 2. Typed mock tools: a real tool's fields, a hand-written result, rehearsal and shadow only
// ---------------------------------------------------------------------------

const csv = (name: string, content: string) => {
  const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
  return { id: `upload_${name}`, name, format: 'csv' as const, bytes: Buffer.byteLength(content), digest: `d-${name}`, contentBase64, clientData: true };
};
function toolEnv(extra: Partial<ToolEnv> = {}): ToolEnv {
  return {
    deps: { services: {}, host: 'test' } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'social-clean', episode: 0 }, files: [csv('posts.csv', 'Date,Post,Likes\n2026-09-01,Hello,abc')], tables: [], receipts: [],
    dictionary: [], sandbox: undefined, now: () => NOW, allowed: [], ...extra,
  };
}
const GRANT: ToolName[] = ['files.list', 'social.report', 'outbox.propose'];

test('typed mock tools: the real tool\'s fields are checked, the hand-written result comes back labelled, and it proves nothing', async () => {
  const hand = { reach: 'about two thousand people', best: 'the Tuesday post' };
  const tool = mockTool('social.report', hand);
  assert.equal(tool.mock, true);
  const env = toolEnv({ mockTools: [tool] });
  const run = (input: unknown) => callTool(env, GRANT, 1, 0, { tool: 'social.report', input: JSON.stringify(input) });
  // The real fields: a call that does not fit them is refused before the mock answers.
  const refused = await run({ nonsense: true });
  assert.equal(refused.record.envelope.ok, false);
  assert.equal(!refused.record.envelope.ok && refused.record.envelope.error.code, 'TOOL_INPUT_INVALID');
  // A call that fits gets the hand-written result, labelled, with no table, receipt or proof.
  const real = await callTool(toolEnv(), GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(real.record.envelope.ok, true);
  const listed = await callTool(env, GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.deepEqual(listed.record.envelope, real.record.envelope, 'a tool with no mock runs for real');
  const wrongPlatform = await run({ month: '2026-09', files: [{ file: 'f1', platform: 'myspace' }] });
  assert.equal(!wrongPlatform.record.envelope.ok && wrongPlatform.record.envelope.error.code, 'TOOL_INPUT_INVALID', 'the real choices hold');
  const answered = await run({ month: '2026-09', files: [{ file: 'f1', platform: 'linkedin' }] });
  assert.equal(answered.record.envelope.ok, true, JSON.stringify(answered.record.envelope));
  assert.deepEqual((answered.record.envelope as any).result, { mock: true, note: MOCK_TOOL_NOTE, result: hand });
  assert.deepEqual(answered.receipts, []);
  assert.deepEqual(answered.tables, []);
  assert.deepEqual(answered.proofs, []);
  // Hand-written results must be plain data.
  assert.throws(() => mockTool('social.report', { when: new Date() } as any), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => mockTool('not.a.tool' as ToolName, {}), code('INVALID_VENTURE_REQUEST'));
});

test('typed mock tools: in a rehearsal loop the turn reads the labelled result; a claim backed only by it fails', async () => {
  const env = toolEnv({ mockTools: [mockTool('files.list', { files: [], note: 'hand-written' })] });
  let state = newHarnessState(GRANT, DEFAULT_LIMITS, []);
  state = await applyTurn(env, state, { note: 'List the files', calls: [{ tool: 'files.list', input: '{}' }], finished: true }, { by: 'model', callId: 'c1', costMicros: '0' });
  const [call] = state.toolCalls;
  assert.equal((call.envelope as any).result.mock, true);
  assert.deepEqual(state.proofs, [], 'a mock result proves nothing');
  assert.equal(claimBacked('reconciled', state.proofs), false);
});

test('typed mock tools: refused on a real run unless the business is at shadow, where nothing is sent', async () => {
  const runRef = { kind: 'delivery' as const, runId: 'run_1' };
  const real = toolEnv({
    runRef, mockTools: [mockTool('files.list', { files: [] })],
    policy: { context: { ...defaultPolicyContext(runRef), approval: { kind: 'owner-turn', callId: 'c1' } } },
  });
  const refused = await callTool(real, GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(refused.record.envelope.ok, false);
  assert.equal(!refused.record.envelope.ok && refused.record.envelope.error.code, 'MOCK_REAL_RUN');
  const shadow = toolEnv({
    runRef, mockTools: [mockTool('files.list', { files: [] })],
    policy: { context: { ...defaultPolicyContext(runRef), posture: 'shadow', approval: { kind: 'owner-turn', callId: 'c1' } } },
  });
  const served = await callTool(shadow, GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(served.record.envelope.ok, true, JSON.stringify(served.record.envelope));
  assert.equal((served.record.envelope as any).result.mock, true);
});

test('static: the mock files reach no network and no real provider', async () => {
  for (const name of ['mocks.ts', 'mock-providers.ts']) {
    const source = await readFile(new URL(`../runtime/venture/delivery/harness/${name}`, import.meta.url), 'utf8');
    for (const banned of ['node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'net-guard', 'guardedFetch', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'child_process', 'browser.ts', 'applyAction(']) {
      assert.ok(!source.includes(banned), `${name} mentions ${banned}`);
    }
  }
});
