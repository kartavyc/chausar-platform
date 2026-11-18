// Ink v2 wave 4 (4J2, O18): the owner's triage rule. venture.triage.preview maps the owner's words ("clients with a
// deadline first") to a typed rule over fixed fields through the owner's own AI, or offers the fixed choices with no AI,
// and returns today's rows re-ranked as a dry run; venture.triage.set saves it and Today's order uses it. A rule never
// hides a row and never changes an id or a digest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import type { ModelOutcome, ModelTask, QueueList, QueueRow, TriagePreview, TriageRule, TriageRuleView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { orderRows, ruleLine, TRIAGE_CHOICES, triageTask, validateRule, withTriage } from '../runtime/venture/views/triage.ts';
import { call, code, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, StubModels, type Env } from './venture-views-env.ts';
import { leadsFindPropose } from '../runtime/venture/customers/find-methods.ts';

/** The owner's AI, answering the triage task with keys; it records what it was sent. */
type TriageModels = StubModels & { answer: unknown; sent: ModelTask<unknown>[] };
function triageModels(): TriageModels {
  const models = Object.assign(new StubModels(), { answer: { keys: [{ field: 'client', order: 'asc' }] } as unknown, sent: [] as ModelTask<unknown>[] });
  const generate = async <T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> => {
    models.sent.push(task as ModelTask<unknown>);
    if (models.answer instanceof Error) throw models.answer;
    return { value: task.validate(structuredClone(models.answer)), by: 'model', callId: 'call_triage', presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  };
  (models as unknown as { generate: typeof generate }).generate = generate;
  return models;
}

const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const preview = (env: Env, text: string, ctx: Context = owner) => call<TriagePreview>(env, 'venture.triage.preview', { text }, ctx);
const save = (env: Env, rule: TriageRule, digest: string, ctx: Context = owner) => call<TriageRuleView>(env, 'venture.triage.set', { rule, digest }, ctx);
const drafts = (rows: QueueRow[]) => rows.filter(row => row.kind === 'draft');

/** Drafts for Zara, Arjun and Meera waiting for review, made in that order, and a price row that leads Today. */
async function today(models?: TriageModels) {
  const env = await setup();
  if (models) { env.deps.models = models; models.connected = true; }
  const plan = await seedBlueprint(env);
  await setStage(env, 'approve-each');
  for (const name of ['Zara Tiles', 'Arjun Prints', 'Meera Cafe']) {
    const { order, client } = await seedOrder(env, plan);
    await ventureAction(env.deps, owner, 'admin', 'seed.name', tx => { tx.replace({ ...tx.find('venture-client', client.id)!, name }); });
    env.advance(60_000);
    await seedRun(env, order, { status: 'ready-for-review', renderedText: '# Draft\n\nThe plan for this month.' });
  }
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900' });
  return env;
}
const clients = (rows: QueueRow[]) => drafts(rows).map(row => row.meta?.client);

test('preview with no AI: the fixed choices, no rule, and today\'s rows as they are', async () => {
  const env = await today();
  const before = await queue(env);
  const shown = await preview(env, 'clients with a deadline first');
  assert.equal(shown.by, 'choices');
  assert.equal(shown.rule, null);
  assert.deepEqual(shown.choices, TRIAGE_CHOICES);
  assert.deepEqual(shown.choices.map(choice => choice.words), ['Nearest deadline first', 'Most money first', 'By client, A to Z', 'By kind of work', 'By business, A to Z', "Chausar's own order"]);
  assert.deepEqual(shown.rows.map(row => row.id), before.rows.map(row => row.id));
  assert.match(shown.digest, /^[a-f0-9]{64}$/);
  // The preview is a dry run: it saves nothing.
  assert.equal(listRecords(env.store.read(), 'venture-triage-rule').length, 0);
});

test('preview with the owner\'s AI maps the words to fixed fields and ranks today\'s rows as a dry run; only the owner\'s words go', async () => {
  const models = triageModels();
  const env = await today(models);
  const shown = await preview(env, 'clients A to Z please');
  assert.equal(shown.by, 'model');
  assert.deepEqual(shown.rule, { keys: [{ field: 'client', order: 'asc' }], words: 'clients A to Z please' });
  assert.deepEqual(clients(shown.rows), ['Arjun Prints', 'Meera Cafe', 'Zara Tiles']);
  assert.equal(shown.rows[0].kind, 'price', 'the plan change still leads');
  const [task] = models.sent;
  assert.equal(task.purpose, 'triage-rule');
  assert.equal(task.containsClientData, false);
  assert.deepEqual(task.input, { words: 'clients A to Z please', fields: ['due', 'client', 'kind', 'money', 'business'] });
  assert.equal(shown.does, 'client A to Z', 'the dry run says what the rule does, in code\'s words');
  assert.ok(!JSON.stringify(task.input).includes('Zara'), 'no row or client goes to the AI');
  // Today's order has not changed yet.
  assert.deepEqual(clients((await queue(env)).rows), ['Zara Tiles', 'Arjun Prints', 'Meera Cafe']);
});

test('an AI answer outside the fixed fields falls back to the choices', async () => {
  const models = triageModels();
  const env = await today(models);
  models.answer = { keys: [{ field: 'secret', order: 'asc' }] };
  const shown = await preview(env, 'hide the small ones');
  assert.deepEqual([shown.by, shown.rule], ['choices', null]);
  models.answer = new ChausarError('MODEL_LIMIT_REACHED', 'The month\'s limit is reached.');
  assert.equal((await preview(env, 'money first')).by, 'choices');
  assert.throws(() => validateRule({ keys: [{ field: 'client', order: 'asc' }, { field: 'client', order: 'desc' }] }, 'x'), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => triageTask('x').validate({ keys: [{ field: 'due', order: 'sideways' }] }), code('MODEL_OUTPUT_REJECTED'));
});

test('set saves the rule and Today uses it: the same rows, each once, with the same ids and digests', async () => {
  const env = await today();
  const before = await queue(env);
  const shown = await preview(env, 'by client');
  const rule = shown.choices.find(choice => choice.words === 'By client, A to Z')!;
  const saved = await save(env, rule, shown.digest);
  assert.equal(saved.line, 'Today is ordered: client A to Z. Nothing is hidden.');
  const after = await queue(env);
  assert.deepEqual(clients(after.rows), ['Arjun Prints', 'Meera Cafe', 'Zara Tiles']);
  assert.equal(after.rows.length, before.rows.length, 'a rule never hides a row');
  const byId = new Map(before.rows.map(row => [row.id, row.digest]));
  assert.ok(after.rows.every(row => byId.get(row.id) === row.digest), 'ids and digests unchanged');
  assert.equal(after.rows[0].kind, 'price', 'the plan change still leads');
  const [stored] = listRecords(env.store.read(), 'venture-triage-rule');
  assert.deepEqual([stored.rule, stored.by], [rule, 'owner']);
  // The digest the dry run carried is spent: a second save from the same dry run is stale.
  await assert.rejects(save(env, TRIAGE_CHOICES[1], shown.digest), code('APPROVAL_STALE'));
  // Back to Chausar's own order.
  const again = await preview(env, 'as before');
  assert.equal((await save(env, TRIAGE_CHOICES[5], again.digest)).line, "Today is in Chausar's own order.");
  assert.deepEqual(clients((await queue(env)).rows), ['Zara Tiles', 'Arjun Prints', 'Meera Cafe']);
});

test('set is app only and takes fixed fields only; preview works from the phone', async () => {
  const env = await today();
  const shown = await preview(env, 'by client', phone);
  await assert.rejects(save(env, TRIAGE_CHOICES[2], shown.digest, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(save(env, { keys: [{ field: 'secret' as never, order: 'asc' }], words: 'x' }, shown.digest), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(save(env, { keys: [{ field: 'due', order: 'asc' }, { field: 'money', order: 'desc' }, { field: 'kind', order: 'asc' }, { field: 'client', order: 'asc' }], words: 'x' }, shown.digest), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(save(env, TRIAGE_CHOICES[2], 'nope'), code('INVALID_VENTURE_REQUEST'));
});

test('orderRows: due and money from the row\'s own fields, rows without a value last, ties in Today\'s order, nothing dropped', () => {
  const base = { businessId: 'main', businessName: 'Ledgerline', title: 't', digest: 'd', actions: [] } as const;
  const row = (id: string, extra: Partial<QueueRow>): QueueRow => ({ ...base, id, kind: 'draft', createdAt: '2026-10-15T10:00:00.000Z', ...extra } as QueueRow);
  const rows = [
    row('a:1', {}),
    row('b:1', { meta: { client: 'B', business: 'L', at: '', expiresAt: '2026-10-20T10:00:00.000Z' } }),
    row('c:1', { kind: 'followup', followup: { cardId: 'c', name: 'C', company: null, due: '2026-10-17', daysLate: 0, channel: null, draftId: null } }),
    row('lock:1', { kind: 'locked' }),
    row('plan:1', { kind: 'plan' }),
  ];
  const state = { conversations: [] } as never;
  const venture = { id: 'v', country: null } as never;
  const byDue = orderRows(state, venture, rows, { keys: [{ field: 'due', order: 'asc' }], words: 'x' });
  assert.deepEqual(byDue.map(item => item.id), ['plan:1', 'c:1', 'b:1', 'a:1', 'lock:1']);
  const latest = orderRows(state, venture, rows, { keys: [{ field: 'due', order: 'desc' }], words: 'x' });
  assert.deepEqual(latest.map(item => item.id), ['plan:1', 'b:1', 'c:1', 'a:1', 'lock:1'], 'no value still last');
  // A business still in its interview has no country: money ranks nothing, and nothing fails.
  assert.deepEqual(orderRows(state, venture, rows, { keys: [{ field: 'money', order: 'desc' }], words: 'x' }).map(item => item.id), ['plan:1', 'a:1', 'b:1', 'c:1', 'lock:1']);
  assert.equal(withTriage({ conversations: [] } as never, rows), rows, 'no business, no rule: the same list');
});

test('rows of another business are never read with the open business\'s state or currency: they rank by business only', () => {
  const base = { title: 't', digest: 'd', actions: [], createdAt: '2026-10-15T10:00:00.000Z' } as const;
  const row = (id: string, extra: Partial<QueueRow>): QueueRow => ({ ...base, id, kind: 'draft', businessId: 'main', businessName: 'Ledgerline', ...extra } as QueueRow);
  const rows = [
    row('mine-z:1', { meta: { client: 'Zara', business: 'Ledgerline', at: '' } }),
    row('other:1', { businessId: 'second', businessName: 'Bakery Books', meta: { client: 'Aaron', business: 'Bakery Books', at: '' } }),
    row('mine-a:1', { meta: { client: 'Arjun', business: 'Ledgerline', at: '' } }),
  ];
  const state = { conversations: [] } as never;
  const venture = { id: 'v', country: null } as never;
  const byClient = orderRows(state, venture, rows, { keys: [{ field: 'client', order: 'asc' }], words: 'x' }, 'main');
  assert.deepEqual(byClient.map(item => item.id), ['mine-a:1', 'mine-z:1', 'other:1'], 'another business\'s client is not read: it goes last');
  const byBusiness = orderRows(state, venture, rows, { keys: [{ field: 'business', order: 'asc' }], words: 'x' }, 'main');
  assert.deepEqual(byBusiness.map(item => item.id), ['other:1', 'mine-z:1', 'mine-a:1']);
});

// Found on Windows, 16 Nov 2026 (screen 094): the owner wrote "Proposals that find customers first", the box said
// "Your words as a rule: Proposals that find customers first", and the dry run read Confirm your tax, Keep this
// business, Find possible customers. A rule could only sort by five fields, so it had no way to say "this kind of item
// first", and the setup cards led whatever the rule said. A rule can now name the kinds of item that lead.
test('"Proposals that find customers first" puts that proposal first, ahead of the setup cards', async () => {
  const models = triageModels();
  const env = await setup();
  env.deps.models = models; models.connected = true;
  env.workspace.keep = 'not-made';
  await seedBlueprint(env, { status: 'accepted', price2: '250000', taxAssumed: true });
  const search = await leadsFindPropose(env.deps, owner, { brief: { who: 'Company offices', place: 'Indore', category: 'office=company', count: 10, source: { kind: 'public-map' } } });
  assert.equal(search.title, 'Find possible customers: company offices in Indore');
  const three = ['Confirm your tax', 'Keep this business', search.title];
  const titles = (rows: QueueRow[]) => rows.map(row => row.title).filter(title => three.includes(title));
  const before = titles((await queue(env)).rows);
  assert.deepEqual([...before].sort(), [...three].sort(), 'the three cards of the tour are on Today');
  assert.equal(before.at(-1), search.title, 'in Chausar\'s own order the setup cards lead');
  models.answer = { first: ['find-customers'], keys: [] };
  const shown = await preview(env, 'Proposals that find customers first');
  assert.equal(shown.by, 'model');
  assert.deepEqual(shown.rule, { keys: [], first: ['find-customers'], words: 'Proposals that find customers first' });
  assert.equal(shown.does, 'proposals that find customers first');
  assert.deepEqual(titles(shown.rows), [search.title, ...before.slice(0, 2)]);
  assert.equal(shown.rows[0]!.title, search.title, 'it leads the whole dry run');
  assert.deepEqual(shown.rows.map(row => row.id).sort(), (await queue(env)).rows.map(row => row.id).sort(), 'the same rows, each once');
  const saved = await save(env, shown.rule!, shown.digest);
  assert.equal(saved.line, 'Today is ordered: proposals that find customers first. Nothing is hidden.');
  assert.equal((await queue(env)).rows[0]!.title, search.title);
  // Any proposal, as a group of its own; and a kind first, then the fields.
  assert.equal(ruleLine({ keys: [{ field: 'due', order: 'asc' }], first: ['proposal', 'draft'], words: 'x' }), 'Today is ordered: proposals first, then drafts, then nearest deadline first. Nothing is hidden.');
  // The vocabulary is fixed: a kind code does not know, a kind twice, or more than three, is refused.
  for (const first of [['secrets'], ['draft', 'draft'], ['draft', 'quote', 'invoice', 'reply'], 'draft']) assert.throws(() => validateRule({ keys: [], first }, 'x'), code('INVALID_VENTURE_REQUEST'));
  // An answer with neither keys nor a kind to lead is no rule: the choices are offered.
  models.answer = { first: [], keys: [] };
  assert.deepEqual([(await preview(env, 'hide the small ones')).by, (await preview(env, 'hide the small ones')).does], ['choices', null]);
});

test('orderRows: the kinds a rule names lead in the order named, locked businesses stay last, another business is never read', () => {
  const base = { businessId: 'main', businessName: 'Ledgerline', title: 't', digest: 'd', actions: [], createdAt: '2026-10-15T10:00:00.000Z' } as const;
  const row = (id: string, kind: QueueRow['kind'], extra: Partial<QueueRow> = {}): QueueRow => ({ ...base, id, kind, ...extra } as QueueRow);
  const rows = [row('setup:1', 'setup'), row('draft:1', 'draft'), row('quote:1', 'quote'), row('draft:2', 'draft'), row('lock:1', 'locked'), row('other:1', 'quote', { businessId: 'second' })];
  const state = { conversations: [] } as never, venture = { id: 'v', country: null } as never;
  const ordered = orderRows(state, venture, rows, { keys: [], first: ['quote', 'draft'], words: 'x' }, 'main');
  assert.deepEqual(ordered.map(item => item.id), ['quote:1', 'draft:1', 'draft:2', 'setup:1', 'other:1', 'lock:1']);
});
