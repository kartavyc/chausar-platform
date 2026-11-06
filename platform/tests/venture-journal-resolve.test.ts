// Ink v2 wave 1 (H3, H21): settling an outside action whose outcome is unknown, from inside the app. The owner looks
// and says what they found: venture.journal.resolve { entryId, outcome: 'sent' | 'not-sent', note? } records it on the
// journal entry, a post or a website edit that needs inspection. Nothing is sent or run again. Every proposed outside
// action also says whether its description shows everything it will send (descriptionComplete, false unless the
// proposer says true). No network anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_ERRORS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { ConnectorPostRecord, JournalEntry, JournalRecord, QueueList, SiteEditRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { applyAction, approveAction, journalled, proposeAction, type ProposeInput } from '../runtime/venture/journal/index.ts';
import { connectorQueueRows } from '../runtime/venture/build/posting.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { previewShownWhole, VIEW_MAX_LINES } from '../runtime/venture/delivery/shared.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { harness, seedBlueprint, seedOrder, seedRun, setStage, setup as viewsSetup } from './venture-views-env.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const web: Context = { ...owner, channel: 'web' };
const agent: Context = { ...owner, channel: 'mcp' };
const phone: Context = { ...owner, channel: 'phone' };
const tainted: Context = { ...owner, sourceTainted: true };
const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const START = Date.parse('2026-10-23T10:00:00.000Z');

function setup() {
  const store = new VentureTestStore();
  let time = START;
  const deps = { store, clock: () => new Date(time) } as unknown as VentureDeps;
  return { store, deps, advance: (ms: number) => { time += ms; } };
}

async function seed(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: null,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
}

const write = (subject: string, over: Partial<ProposeInput> = {}): ProposeInput => ({
  action: 'connector.write', subject, target: 'Mail app', actionDigest: createHash('sha256').update(subject).digest('hex'), line: 'Send the reminder email.', operation: 'send-deliverable', ...over,
});
const resolve = (deps: VentureDeps, ctx: Context, payload: unknown) => views['venture.journal.resolve']!(deps, ctx, payload) as Promise<{ entry: JournalEntry }>;
const journalList = async (deps: VentureDeps) => (await views['venture.journal.list']!(deps, owner, {}) as { entries: JournalEntry[] }).entries;
const entry = (deps: VentureDeps, id: string) => listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.id === id)!;

/** A send that came back unclear: outcome_unknown, with a counter that shows it never runs again. */
async function unknownSend(deps: VentureDeps, subject: string) {
  const proposed = await proposeAction(deps, agent, write(subject));
  const { token } = await approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
  let calls = 0;
  const done = await applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: `key-${subject}` }, async () => {
    calls += 1;
    return { outcome: 'unknown' as const, line: 'The mail app did not confirm the send.', value: null };
  });
  assert.equal(done.entry.state, 'outcome_unknown');
  return { id: proposed.id, calls: () => calls };
}

// ---------------------------------------------------------------------------
// 1. Settling a journal entry
// ---------------------------------------------------------------------------

test('not-sent settles an unknown send as rejected with the owner\'s words, and the same thing may be proposed again', async () => {
  const { deps } = setup();
  await seed(deps);
  const send = await unknownSend(deps, 'reminder_1');
  await assert.rejects(proposeAction(deps, agent, write('reminder_1')), code('JOURNAL_OUTCOME_UNKNOWN'), 'refused while unknown');

  const { entry: shown } = await resolve(deps, owner, { entryId: send.id, outcome: 'not-sent', note: 'Not in the sent folder.' });
  assert.equal(shown.id, send.id);
  assert.equal(shown.state, 'rejected');
  assert.equal(shown.line, 'You checked: it did not happen. Propose it again to do it. Your note: Not in the sent folder.');
  const stored = entry(deps, send.id);
  assert.equal(stored.state, 'rejected');
  assert.equal(stored.outcome?.by, 'owner');
  assert.deepEqual(stored.journal.map(step => step.state), ['described', 'approved', 'outcome_unknown', 'rejected']);
  assert.equal(stored.journal.at(-1)!.line, shown.line);
  assert.equal(send.calls(), 1, 'recording what the owner found never resends');

  const again = await proposeAction(deps, agent, write('reminder_1'));
  assert.notEqual(again.id, send.id);
  assert.equal(again.state, 'described', 'not sent, so it may be asked for again');
});

test('sent settles an unknown send as applied; it is never proposed or run again', async () => {
  const { deps } = setup();
  await seed(deps);
  const send = await unknownSend(deps, 'reminder_2');
  const { entry: shown } = await resolve(deps, web, { entryId: send.id, outcome: 'sent' });
  assert.equal(shown.state, 'applied');
  assert.equal(shown.line, 'You checked: it happened.');
  assert.equal(entry(deps, send.id).outcome?.by, 'owner');
  await assert.rejects(proposeAction(deps, agent, write('reminder_2')), code('JOURNAL_ALREADY_DECIDED'), 'it went out, so the same send is refused');
  assert.equal(send.calls(), 1);
  const listed = (await journalList(deps)).find(item => item.id === send.id)!;
  assert.deepEqual([listed.state, listed.line], ['applied', 'You checked: it happened.']);
});

test('only an unknown outcome can be settled: every other state is JOURNAL_NOT_UNKNOWN, an unknown id JOURNAL_NOT_FOUND', async () => {
  const { deps } = setup();
  await seed(deps);
  const described = await proposeAction(deps, agent, write('waiting'));
  const approved = await proposeAction(deps, agent, write('approved'));
  await approveAction(deps, owner, { entryId: approved.id, digest: approved.actionDigest });
  const applied = await journalled(deps, owner, write('applied'), async () => ({ outcome: 'applied', line: 'Sent.', value: null }));
  const rejected = await journalled(deps, owner, write('rejected'), async () => ({ outcome: 'not-sent', line: 'Sign in first.', value: null }));
  for (const id of [described.id, approved.id, applied.entry.id, rejected.entry.id]) {
    await assert.rejects(resolve(deps, owner, { entryId: id, outcome: 'sent' }), code('JOURNAL_NOT_UNKNOWN'), id);
  }
  const send = await unknownSend(deps, 'twice');
  await resolve(deps, owner, { entryId: send.id, outcome: 'sent' });
  await assert.rejects(resolve(deps, owner, { entryId: send.id, outcome: 'not-sent' }), code('JOURNAL_NOT_UNKNOWN'), 'settled once');
  await assert.rejects(resolve(deps, owner, { entryId: 'vjrn_missing', outcome: 'sent' }), code('JOURNAL_NOT_FOUND'));
});

test('the owner settles it inside the app: never an agent, the phone or tainted text, never a viewer; the payload is exact', async () => {
  const { deps, store } = setup();
  await seed(deps);
  await store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: [] }); });
  const send = await unknownSend(deps, 'guarded');
  for (const ctx of [agent, phone, tainted]) await assert.rejects(resolve(deps, ctx, { entryId: send.id, outcome: 'sent' }), code('APP_APPROVAL_REQUIRED'), ctx.channel);
  await assert.rejects(resolve(deps, viewer, { entryId: send.id, outcome: 'sent' }), code('FORBIDDEN'));
  for (const payload of [
    {}, { entryId: send.id }, { entryId: send.id, outcome: 'applied' }, { entryId: send.id, outcome: 'sent', other: true },
    { entryId: 'not an id!', outcome: 'sent' }, { entryId: send.id, outcome: 'sent', note: 'two\nlines' }, { entryId: send.id, outcome: 'sent', note: 'x'.repeat(301) },
    { entryId: send.id, outcome: 'sent', note: 7 },
  ]) {
    await assert.rejects(resolve(deps, owner, payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload).slice(0, 80));
  }
  assert.equal(entry(deps, send.id).state, 'outcome_unknown', 'nothing refused changed it');
  const audit = store.read().activity.filter((item: any) => item.event === 'venture.journal.resolve');
  assert.equal(audit.length, 0);
  await resolve(deps, owner, { entryId: send.id, outcome: 'sent' });
  assert.equal(store.read().activity.filter((item: any) => item.event === 'venture.journal.resolve').length, 1, 'the settlement is audited');
});

// ---------------------------------------------------------------------------
// 2. Posts and website edits settle through the same method
// ---------------------------------------------------------------------------

async function seedUnknownPost(deps: VentureDeps): Promise<ConnectorPostRecord> {
  return ventureAction(deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId: 'linkedin', mode: 'owner-browser-session', account: null, text: 'Our cafe books service is open.', agent: null,
    digest: 'd'.repeat(64), state: 'outcome_unknown', describe: 'Post to LinkedIn from your own browser on this computer.', risk: null, claimedAt: tx.now,
    decidedBy: 'owner', outcome: { line: 'The browser stopped part way.', url: null, by: 'engine' },
    journal: [
      { state: 'described', at: tx.now, by: 'owner', line: 'Post to LinkedIn from your own browser on this computer.' },
      { state: 'approved', at: tx.now, by: 'owner', line: 'You approved this post.' },
      { state: 'outcome_unknown', at: tx.now, by: 'engine', line: 'The browser stopped part way. Check LinkedIn before posting again.' },
    ],
  }));
}

test('a post\'s unknown outcome settles through venture.journal.resolve, in the post\'s own words', async () => {
  const { deps } = setup();
  await seed(deps);
  const went = await seedUnknownPost(deps);
  const { entry: posted } = await resolve(deps, owner, { entryId: went.id, outcome: 'sent' });
  assert.deepEqual([posted.action, posted.target, posted.state, posted.line], ['Post', 'LinkedIn', 'applied', 'You checked LinkedIn: the post went out.']);
  const stored = listRecords(deps.store.read(), 'venture-connector-post').find(post => post.id === went.id)!;
  assert.equal(stored.state, 'applied');
  assert.equal(stored.outcome?.by, 'owner');

  const lost = await seedUnknownPost(deps);
  const { entry: notPosted } = await resolve(deps, owner, { entryId: lost.id, outcome: 'not-sent', note: 'Not on my feed.' });
  assert.equal(notPosted.state, 'rejected');
  assert.equal(notPosted.line, 'You checked LinkedIn: the post did not go out. Propose it again to post it. Your note: Not on my feed.');
  await assert.rejects(resolve(deps, owner, { entryId: lost.id, outcome: 'sent' }), code('JOURNAL_NOT_UNKNOWN'));
});

async function seedInspection(deps: VentureDeps, direction: 'applied' | 'rolled-back') {
  return ventureAction(deps, owner, 'prepare', 'seed.site', tx => {
    const edit = tx.put<SiteEditRecord>({
      ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:C:/site' }, path: 'index.html', summary: 'New opening hours',
      before: 'a', after: 'b', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'needs-inspection',
      log: [
        { at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New opening hours' },
        ...(direction === 'rolled-back' ? [{ at: tx.now, by: 'owner', step: 'applied' as const, line: 'Applied the edit you reviewed.' }] : []),
        { at: tx.now, by: 'engine', step: 'needs-inspection', line: 'The write could not be confirmed. Check the file before trying again. The original is kept in this edit.' },
      ],
    });
    const journal = tx.put<JournalRecord>({
      ...tx.base('venture-journal-entry'), action: 'site.apply', subject: `${edit.id}.${direction}`, target: 'index.html', actionDigest: 'z',
      describe: 'Apply the website edit: New opening hours', agent: null, shadow: false, quote: null, state: 'outcome_unknown', claimedAt: tx.now,
      decidedBy: 'owner', outcome: { line: 'The write could not be confirmed.', url: null, by: 'engine' }, receiptId: null, approval: null, expiresAt: tx.now,
      journal: [
        { state: 'described', at: tx.now, by: 'owner', line: 'Apply the website edit: New opening hours' },
        { state: 'approved', at: tx.now, by: 'owner', line: 'You approved this.' },
        { state: 'outcome_unknown', at: tx.now, by: 'engine', line: 'The write could not be confirmed. Check the file before trying again.' },
      ],
    });
    return { edit, journal };
  });
}

test('a website edit that needs inspection settles by its own id: written moves it on, not written puts it back', async () => {
  const { deps } = setup();
  await seed(deps);
  const written = await seedInspection(deps, 'applied');
  const listed = (await journalList(deps)).find(item => item.id === written.edit.id)!;
  assert.equal(listed.state, 'outcome_unknown', 'the journal shows it as an unknown outcome');
  const { entry: shown } = await resolve(deps, owner, { entryId: written.edit.id, outcome: 'sent' });
  assert.deepEqual([shown.id, shown.state, shown.line], [written.edit.id, 'applied', 'You checked the file: the change was written.']);
  const edits = () => new Map(listRecords(deps.store.read(), 'venture-site-edit').map(edit => [edit.id, edit]));
  assert.equal(edits().get(written.edit.id)!.state, 'applied');
  assert.equal(edits().get(written.edit.id)!.log.at(-1)!.by, 'owner');
  assert.equal(entry(deps, written.journal.id).state, 'applied', 'its journal entry settles with it');

  const notWritten = await seedInspection(deps, 'applied');
  const back = await resolve(deps, owner, { entryId: notWritten.edit.id, outcome: 'not-sent' });
  assert.deepEqual([back.entry.state, back.entry.line], ['described', 'You checked the file: the change was not written. You can try again.']);
  assert.equal(edits().get(notWritten.edit.id)!.state, 'staged', 'back to waiting for you, so it can be applied again');
  assert.equal(entry(deps, notWritten.journal.id).state, 'rejected');

  const undo = await seedInspection(deps, 'rolled-back');
  await resolve(deps, owner, { entryId: undo.journal.id, outcome: 'not-sent' });
  assert.equal(edits().get(undo.edit.id)!.state, 'applied', 'an undo that did not happen leaves the edit applied');
  assert.equal(entry(deps, undo.journal.id).state, 'rejected');
  await assert.rejects(resolve(deps, owner, { entryId: undo.edit.id, outcome: 'sent' }), code('JOURNAL_NOT_UNKNOWN'));
});

// ---------------------------------------------------------------------------
// 3. descriptionComplete on every proposed outside action (H21)
// ---------------------------------------------------------------------------

test('every proposed outside action says whether its description is complete: false unless the proposer says true', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const plain = await proposeAction(deps, agent, write('plain'));
  assert.equal(plain.descriptionComplete, false);
  const complete = await proposeAction(deps, agent, write('complete', { descriptionComplete: true }));
  assert.equal(complete.descriptionComplete, true);
  assert.equal(entry(deps, complete.id).descriptionComplete, true, 'stored on the record');
  const once = await journalled(deps, owner, write('once'), async () => ({ outcome: 'applied', line: 'Sent.', value: null }));
  assert.equal((once.entry as JournalRecord).descriptionComplete, false);
  for (const value of ['yes', 1, null]) {
    await assert.rejects(proposeAction(deps, agent, write(`bad_${String(value)}`, { descriptionComplete: value as any })), code('INVALID_VENTURE_REQUEST'), String(value));
  }

  // A post waiting on Today carries it on its row; a post made before the field is incomplete.
  await ventureAction(deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId: 'x', mode: 'owner-browser-session', account: null, text: 'Hello', agent: 'Social writer', digest: 'e'.repeat(64),
    state: 'described', describe: 'Post to X from your own browser on this computer.', risk: null, claimedAt: null, decidedBy: null, outcome: null,
    journal: [{ state: 'described', at: tx.now, by: 'Social writer', line: 'Post to X from your own browser on this computer.' }],
    approval: null, expiresAt: new Date(START + 15 * 60_000).toISOString(),
  }));
  const [row] = connectorQueueRows(store.read());
  assert.equal(row.descriptionComplete, false, 'a post stored before the field is incomplete');
  const queue = await views['venture.queue.list']!(deps, owner, {}) as QueueList;
  const postRow = queue.rows.find(item => item.kind === 'connector' && item.title === 'Post to X')!;
  assert.equal(postRow.descriptionComplete, false, 'Today shows the incomplete-description line on this row');
  const others = queue.rows.filter(item => item !== postRow);
  assert.ok(others.length > 0);
  assert.ok(others.every(item => item.descriptionComplete === undefined), 'rows that lead to no outside action leave it out');
});

const PREVIEW = {
  callId: 'call_1', payloadText: '{"system":"Close the September books."}', digest: 'c'.repeat(64), presetId: 'anthropic-sonnet-5-5' as const,
  model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010',
  expiresAt: '2026-10-15T10:30:00.000Z',
};

test('the run Approve row and a held call carry it too: true only when the view shows the exact text that goes out', async () => {
  // The rule: the run's view shows the text line by line up to its cap, and a command-line send also passes a schema file it only names.
  assert.equal(previewShownWhole(PREVIEW), true);
  const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}`).join('\n');
  assert.equal(previewShownWhole({ ...PREVIEW, payloadText: lines(VIEW_MAX_LINES + 1) }), false);
  assert.equal(previewShownWhole({ ...PREVIEW, payloadText: lines(VIEW_MAX_LINES) }), true);
  assert.equal(previewShownWhole({ endpoint: 'cli://claude', payloadText: JSON.stringify({ command: 'claude', args: ['--json-schema', '<schema-file>'], stdin: 'Close the books.' }) }), false);

  const env = await viewsSetup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  env.models.connected = true;
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const fields = { playbookId: playbook.id, playbookHash: playbook.hash };
  const whole = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', preview: PREVIEW, harness: harness() });
  const cli = { ...PREVIEW, callId: 'call_2', endpoint: 'cli://claude', payloadText: JSON.stringify({ command: 'claude', args: ['<schema-file>'], stdin: 'x' }) };
  const named = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_2', preview: cli, harness: harness() });
  const question = 'Write to the mail app is on hold, so it waits for you. The agent wants to run outbox.propose. Let it run once?';
  const held = await seedRun(env, order, {
    ...fields, status: 'needs-answer',
    harness: harness({
      phase: 'needs-answer', used: { turns: 1, toolCalls: 0, costMicros: '1000' }, handoffs: [{ to: 'owner', question, turn: 1, answer: null, answeredBy: null }],
      holds: [{ id: 'h1.1', toolCallId: 't1.1', tool: 'outbox.propose', stepId: 'send', inputDigest: 'd'.repeat(64), code: 'step_on_hold', reason: 'Write to the mail app is on hold, so it waits for you.', turn: 1, handoff: 0, status: 'waiting', validTurn: null }],
    }),
  });
  const rows = (await views['venture.queue.list']!(env.deps, owner, {}) as QueueList).rows;
  const rowFor = (runId: string) => rows.find(item => item.viewRef?.id === runId)!;
  assert.equal(rowFor(whole.id).descriptionComplete, true, 'the view shows the exact text that goes to the AI');
  assert.equal(rowFor(named.id).descriptionComplete, false, 'the schema file is named, not shown');
  assert.equal(rowFor(held.id).descriptionComplete, false, 'the view names the held tool but not its exact input');

  // The send's own journal entry says the same as the row the owner approved.
  await assert.rejects(delivery['venture.delivery.approve']!(env.deps, owner, { runId: whole.id, digest: PREVIEW.digest }));
  const sent = listRecords(env.store.read(), 'venture-journal-entry').find(entry => entry.action === 'delivery.send' && entry.subject === `${whole.id}:call_1`)!;
  assert.equal(sent.descriptionComplete, true);
});

// ---------------------------------------------------------------------------
// 4. Registration and house rules
// ---------------------------------------------------------------------------

test('venture.journal.resolve is an app-only views method registered everywhere a venture method must be', async () => {
  assert.ok((VENTURE_METHODS as readonly string[]).includes('venture.journal.resolve'));
  assert.equal(METHOD_OWNERS['venture.journal.resolve' as keyof typeof METHOD_OWNERS], 'views');
  assert.ok((APP_ONLY_METHODS as readonly string[]).includes('venture.journal.resolve'));
  assert.equal(typeof views['venture.journal.resolve'], 'function');
  for (const error of ['JOURNAL_NOT_UNKNOWN', 'MODEL_OUTCOME_UNKNOWN']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(error), error);
  const ipc = await readFile(new URL('../../app/desktop/ipc-contract.cjs', import.meta.url), 'utf8');
  const types = await readFile(new URL('../../app/desktop/ipc-contract.d.cts', import.meta.url), 'utf8');
  const engine = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../../app/ui/src/engine/types.ts', import.meta.url), 'utf8');
  assert.ok(ipc.includes("'venture.journal.resolve'"), 'ipc allowlist');
  assert.ok(types.includes('"venture.journal.resolve"'), 'ipc types');
  assert.ok(engine.includes("case 'venture.journal.resolve':"), 'engine routing');
  assert.ok(ui.includes("'venture.journal.resolve'"), 'ui types');
});

test('every line the settlement writes keeps the house style', async () => {
  const { deps } = setup();
  await seed(deps);
  const lines: string[] = [];
  for (const outcome of ['sent', 'not-sent'] as const) {
    lines.push((await resolve(deps, owner, { entryId: (await unknownSend(deps, `style_${outcome}`)).id, outcome })).entry.line);
    lines.push((await resolve(deps, owner, { entryId: (await seedUnknownPost(deps)).id, outcome })).entry.line);
    lines.push((await resolve(deps, owner, { entryId: (await seedInspection(deps, 'applied')).edit.id, outcome })).entry.line);
  }
  for (const line of lines) assert.deepEqual(houseStyleFindings(line), [], line);
});
