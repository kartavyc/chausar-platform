// Package 4D2 (Ink v2 wave 4): how well the owner knows each person, computed in code from the owner's own files and
// records, never by a model. A fixed weight table with its source note, a 180-day half-life stated as Chausar's own
// choice, whole numbers through a fixed 180-entry table; outcomes, not raw numbers; after every import, one tie per
// person and one evidence row per signal, with Keeper's run; the receipt shows every step; the bands count has its own
// receipt; "you said" with the owner as the source. The clock is fixed at 23 Oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { APP_ONLY_METHODS, TIE_BANDS, W4_METHOD_LEVELS } from '../runtime/venture/contracts.ts';
import type {
  EvidenceRecord, KeeperRunRecord, NetworkRecompute, NetworkSourcesView, PersonView, SumReceiptRecord, TieBand, TieReceipt,
} from '../runtime/venture/contracts.ts';
import { evidenceQuestions, personEvidence } from '../runtime/venture/evidence/ledger.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { redactSecrets } from '../runtime/venture/core/secrets.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { BAND_FROM, bandOf, faded, FADE_TABLE, HALF_LIFE_DAYS, TIE_WEIGHTS, WEIGHTS_NOTE } from '../runtime/venture/network/strength.ts';
import { personSummary } from '../runtime/venture/network/people.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { connectionsCsv, net, people, personNamed, projected } from './venture-network-env.ts';
import { bothWays, ics, imported, mailFile, OWNER, receipt, seedPayingClient, tieOf, ties, toOct23, type Mail } from './venture-network-ties-env.ts';

const PRIYA = 'Priya Nair <priya@acme.example>';
const SAMEER = 'Sameer Kulkarni <sameer@neem.example>';

/** Priya: mail both ways in each of the last 6 months, the last on 20 Oct. */
const PRIYA_MAIL: Mail[] = [
  ...bothWays(PRIYA, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']),
  { day: '2026-10-18', from: OWNER, to: [PRIYA] },
  { day: '2026-10-20', from: PRIYA, to: [OWNER] },
];
/** Two small meetings with Priya in the last 30 days, the last on 15 Oct. */
const PRIYA_MEETINGS = [
  { day: '2026-10-08', title: 'Acme gift boxes', people: ['priya@acme.example'] },
  { day: '2026-10-15', title: 'Acme samples', people: ['priya@acme.example'] },
];

/** Priya's mail and meetings imported: takeout.mbox, then work.ics. */
async function priya(env: Env) {
  await imported(env, 'mail-headers', 'takeout.mbox', mailFile(PRIYA_MAIL));
  await imported(env, 'calendar-ics', 'work.ics', ics(PRIYA_MEETINGS));
  return personNamed(env, 'Priya Nair');
}

const evidenceOf = (env: Env, personId: string): EvidenceRecord[] =>
  listRecords(env.store.read(), 'venture-evidence').filter(row => row.subject === `person:${personId}`);
const bandReceipts = (env: Env) => listRecords(env.store.read(), 'venture-sum-receipt').filter(item => item.subject.type === 'count' && item.subject.what === 'bands');

test('the weight table with its source note, the fixed 180-entry fade table in whole numbers, and the five bands', () => {
  assert.deepEqual(TIE_WEIGHTS, {
    'mail-both': { perBp: 400, capBp: 2400, per: 'month' },
    'mail-one': { perBp: 50, capBp: 300, per: 'month' },
    meeting: { perBp: 300, capBp: 1800, per: 'each' },
    client: { perBp: 1500, capBp: null, per: 'once' },
    contact: { perBp: 300, capBp: null, per: 'once' },
    'linkedin-messages': { perBp: 150, capBp: 900, per: 'month' },
    'linkedin-connection': { perBp: 100, capBp: null, per: 'once' },
    'you-said': { perBp: 500, capBp: null, per: 'once', wellBp: 1800 },
  });
  assert.match(WEIGHTS_NOTE, /^Chausar's own weights; tuned later from your outcomes\. /);
  assert.match(WEIGHTS_NOTE, /saying you know someone well weighs 1,800 on its own, and saying you have met them 500\.$/);
  assert.equal(TIE_WEIGHTS['you-said'].wellBp, BAND_FROM['know-well'], 'the owner\'s "well" alone reaches Know well');
  assert.equal(HALF_LIFE_DAYS, 180);
  assert.equal(FADE_TABLE.length, 180);
  for (let day = 0; day < 180; day += 1) {
    assert.ok(Number.isInteger(FADE_TABLE[day]), `entry ${day} is a whole number`);
    assert.equal(FADE_TABLE[day], Math.round(1_000_000 * 2 ** (-day / 180)), `entry ${day} is 2 to the power of minus ${day}/180, in millionths`);
    if (day) assert.ok(FADE_TABLE[day] < FADE_TABLE[day - 1]);
  }
  // Whole halvings and the table: no floating point in the code that fades a weight.
  assert.deepEqual([faded(400, 0).bp, faded(400, 180).bp, faded(400, 360).bp, faded(400, 540).bp], [400, 200, 100, 50]);
  assert.deepEqual(faded(2400, 3), { bp: 2372, days: 3, halvings: 0, factor: 988_514 });
  assert.equal(faded(300, -4).bp, 300, 'a date after today never makes a signal grow');
  const source = readFileSync(new URL('../runtime/venture/network/strength.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(pow|exp|log|round)|[^/]\*\*[^/]|parseFloat|toFixed/);

  assert.deepEqual(BAND_FROM, { close: 2700, 'know-well': 1800, know: 1000, 'met-once': 150 });
  const cases: [number, TieBand][] = [[10_000, 'close'], [2700, 'close'], [2699, 'know-well'], [1800, 'know-well'], [1799, 'know'], [1000, 'know'], [999, 'met-once'], [150, 'met-once'], [149, 'cold'], [0, 'cold']];
  for (const [score, band] of cases) assert.equal(bandOf(score), band, `${score}`);
  const dots = TIE_BANDS.map(band => personSummary({ id: 'p', name: 'A B', role: null, hidden: false } as never, { band } as never).dots);
  assert.deepEqual(dots, [5, 4, 3, 2, 1], 'five dots for Close down to one for Cold');
});

test('outcomes on 23 Oct 2026: steady mail and two recent meetings is Close; the same three years old is not; a connection alone is Cold; a client invoiced last month is Know', async () => {
  const env = await setup();
  toOct23(env);
  const old: Mail[] = [
    ...bothWays(SAMEER, ['2023-05', '2023-06', '2023-07', '2023-08', '2023-09']),
    { day: '2023-10-18', from: OWNER, to: [SAMEER] }, { day: '2023-10-20', from: SAMEER, to: [OWNER] },
  ];
  await imported(env, 'mail-headers', 'takeout.mbox', mailFile([...PRIYA_MAIL, ...old]));
  await imported(env, 'calendar-ics', 'work.ics', ics([
    ...PRIYA_MEETINGS,
    { day: '2023-10-08', title: 'Neem catalogue', people: ['sameer@neem.example'] }, { day: '2023-10-15', title: 'Neem samples', people: ['sameer@neem.example'] },
  ]));
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  const { person: neha } = await seedPayingClient(env, 'Neha Shah', 'neha@shah.example', '2026-09-20');
  await net<NetworkRecompute>(env, 'venture.network.recompute', {});
  const band = (id: string) => tieOf(env, id).band;
  assert.equal(band(personNamed(env, 'Priya Nair').id), 'close');
  assert.ok(['met-once', 'cold'].includes(band(personNamed(env, 'Sameer Kulkarni').id)), 'three years of fading');
  assert.equal(band(personNamed(env, 'Farhan Ali').id), 'cold');
  assert.equal(band(neha.id), 'know');
  const client = tieOf(env, neha.id).signals;
  assert.deepEqual(client.map(signal => [signal.kind, signal.count, signal.last, signal.weightBp, signal.decayedBp, signal.source, signal.line]), [
    ['client', 1, '2026-09-20', 1500, 1320, 'Your invoices in Chausar', 'Your paying client, 1 invoice, the last invoice or payment on 20 Sep 2026'],
  ]);
});

test('every import works the ties out again: one tie per person with each signal, one evidence row per signal, and Keeper\'s run', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  assert.equal(ties(env).length, 1, 'one import alone gives the ties');
  const p = await priya(env);
  assert.deepEqual(ties(env).map(tie => tie.personId).sort(), people(env).map(item => item.id).sort(), 'one tie per person');
  const tie = tieOf(env, p.id);
  assert.match(tie.id, /^tie_/);
  assert.deepEqual(tie.signals, [
    { kind: 'mail-both', count: 6, last: '2026-10-20', weightBp: 2400, decayedBp: 2372, source: 'Mail headers, takeout.mbox', line: 'Mail both ways in 6 months, the last on 20 Oct 2026' },
    { kind: 'meeting', count: 2, last: '2026-10-15', weightBp: 600, decayedBp: 581, source: 'Calendar, work.ics', line: '2 small meetings, the last on 15 Oct 2026' },
  ]);
  assert.deepEqual([tie.scoreBp, tie.band, tie.computedAt], [2953, 'close', env.now()]);
  assert.match(tie.digest, /^[0-9a-f]{64}$/);

  const rows = evidenceOf(env, p.id);
  const worked = 'Worked out by Chausar from your own files and records';
  assert.deepEqual(rows.map(row => [row.field, row.value, row.type, row.source, row.by, row.applied]), [
    ['tie.mail-both', 'Mail both ways in 6 months, the last on 20 Oct 2026', 'engine-computed', `${worked}: Mail headers, takeout.mbox`, 'engine', true],
    ['tie.meeting', '2 small meetings, the last on 15 Oct 2026', 'engine-computed', `${worked}: Calendar, work.ics`, 'engine', true],
  ]);
  assert.ok(rows.every(row => row.type !== 'document'), 'never "read from a file in the run": no run read it');
  assert.equal(evidenceQuestions(env.store.read(), env.venture.id).length, 0, 'tie evidence never waits on Today as a question');

  const keeper = listRecords(env.store.read(), 'venture-keeper-run').filter(run => run.job === 'network-strength') as KeeperRunRecord[];
  assert.equal(keeper.length, 1, 'one record for the job, replaced each run');
  assert.equal(keeper[0].outcome, 'ok');
  assert.match(keeper[0].line, /^Worked out how well you know 2 people: 1 Close, 1 Cold\./);
  assert.ok(env.published.flat().some(event => event.name === 'keeper.ran'));

  // Again the same day: nothing changed, so no tie and no evidence row is written again.
  const before = { ties: ties(env).map(item => item.id), rows: listRecords(env.store.read(), 'venture-evidence').map(row => row.id) };
  const again = await net<NetworkRecompute>(env, 'venture.network.recompute', {}, phone);
  assert.deepEqual([again.ties, again.computedAt], [2, env.now()]);
  assert.match(again.line, /2 people/);
  assert.deepEqual({ ties: ties(env).map(item => item.id), rows: listRecords(env.store.read(), 'venture-evidence').map(row => row.id) }, before);
});

test('venture.receipt.get serves the tie receipt: a line per signal with its source, and every step in whole numbers', async () => {
  const env = await setup();
  toOct23(env);
  const p = await priya(env);
  const tie = tieOf(env, p.id);
  const served = await receipt<TieReceipt>(env, tie.id, phone);
  assert.deepEqual([served.id, served.kind, served.operation, served.personId, served.at, served.band, served.totalBp, served.stale], [tie.id, 'venture-tie', 'venture.tie', p.id, tie.computedAt, 'close', '2953', false]);
  assert.deepEqual(served.lines, ['Mail both ways in 6 months, the last on 20 Oct 2026 (Mail headers, takeout.mbox)', '2 small meetings, the last on 15 Oct 2026 (Calendar, work.ics)']);
  assert.deepEqual(served.steps.map(step => [step.op, step.inputs, step.result]), [
    ['multiply', ['6', '400'], '2400'],
    ['fade', ['2400', '3', '988514', '0'], '2372'],
    ['multiply', ['2', '300'], '600'],
    ['fade', ['600', '8', '969663', '0'], '581'],
    ['add', ['2372', '581'], '2953'],
    ['band', ['2953'], 'close'],
  ]);
  for (const step of served.steps) for (const value of [...step.inputs, step.result]) assert.match(value, /^(?:\d+|close|know-well|know|met-once|cold)$/);
  assert.deepEqual(served.figures.map(figure => [figure.label, figure.display]), [['How well you know Priya Nair', '2,953 of 10,000: Close']]);
  assert.match(served.explanation, /Chausar's code on 23 Oct 2026/);
  assert.match(served.explanation, /Chausar's own weights; tuned later from your outcomes\./);
  assert.match(served.explanation, /the half-life is Chausar's own choice/);
  assert.match(served.explanation, /Close from 2,700/);
  assert.ok(!served.explanation.includes(String.fromCharCode(0x2014)), 'no long dash in the receipt');
  assert.ok(served.allowedNumbers.includes('2,953'));
  await assert.rejects(receipt(env, 'tie_nobody'), code('RECEIPT_NOT_FOUND'));

  // A cap shows its own step: seven months both ways is 2,800, capped at 2,400.
  const capped = await setup();
  toOct23(capped);
  await imported(capped, 'mail-headers', 'long.mbox', mailFile(bothWays(PRIYA, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])));
  const long = await receipt<TieReceipt>(capped, tieOf(capped, personNamed(capped, 'Priya Nair').id).id);
  assert.deepEqual(long.steps.slice(0, 2).map(step => [step.op, step.inputs, step.result]), [['multiply', ['7', '400'], '2800'], ['cap', ['2800', '2400'], '2400']]);
});

test('a re-imported month is never counted twice, and months only known by the month fade from the first of that month', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'mail-headers', 'sep-oct.mbox', mailFile(bothWays(PRIYA, ['2026-09', '2026-10'])));
  // A newer export of the same days again, plus one mail Priya was only copied on in October.
  await imported(env, 'mail-headers', 'oct.mbox', mailFile([...bothWays(PRIYA, ['2026-10']), { day: '2026-10-16', from: 'Ravi <ravi@acme.example>', to: [OWNER], cc: [PRIYA] }]));
  const [both] = tieOf(env, personNamed(env, 'Priya Nair').id).signals;
  assert.deepEqual([both.kind, both.count], ['mail-both', 2], 'September and October, once each');
  // October also had a mail she was only copied on, so the last day of the both-ways mail is known only to the month.
  assert.deepEqual([both.last, both.line], ['2026-10-01', 'Mail both ways in 2 months, the last in Oct 2026']);
  assert.equal(both.source, 'Mail headers, sep-oct.mbox and oct.mbox');
});

test('venture.network.sources gains the bands, from a count receipt listing each tie counted; hidden people are left out', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv([
    'Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026',
    'Meera,Das,https://www.linkedin.com/in/meera-das,,Dewdrop Naturals,Designer,10 Jan 2025',
  ]));
  const p = await priya(env);
  const view = await net<NetworkSourcesView>(env, 'venture.network.sources', {}, phone);
  assert.ok(view.bands);
  const { receiptId, permille, ...counts } = view.bands;
  assert.deepEqual(counts, { close: 1, knowWell: 0, know: 0, metOnce: 0, cold: 2 });
  // 4D4: each band's share per mille, floored by code (1 of 3 is 333, 2 of 3 is 666), so a screen never divides.
  assert.deepEqual(permille, { close: 333, knowWell: 0, know: 0, metOnce: 0, cold: 666 });
  const sum = await receipt<SumReceiptRecord>(env, receiptId);
  assert.deepEqual([sum.kind, sum.unit, sum.subject, sum.totalMinor, sum.stale], ['venture-sum-receipt', 'count', { type: 'count', what: 'bands', scope: 'all', from: '2026-10-23', to: '2026-10-23' }, '3', false]);
  // Each addend is a tie, by its id and band: a receipt about the network never holds a name.
  assert.deepEqual(sum.addends.map(addend => [addend.label, addend.amount]), sum.addends.map((addend, i) => [`${addend.recordId}: ${['Close', 'Cold', 'Cold'][i]}`, '1']));
  assert.deepEqual(sum.addends.map(addend => addend.recordId).sort(), ties(env).map(tie => tie.id).sort());
  assert.ok(!/Priya|Farhan|Meera/.test(JSON.stringify(sum)));
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources', {})).bands!.receiptId, receiptId, 'the same count opens the same receipt');

  await net(env, 'venture.network.hide', { personId: personNamed(env, 'Meera Das').id, hidden: true });
  const hidden = await net<NetworkSourcesView>(env, 'venture.network.sources', {});
  assert.equal(hidden.bands!.cold, 1, 'hidden people are left out, as in every list');
  assert.notEqual(hidden.bands!.receiptId, receiptId);
  await assert.rejects(receipt(env, receiptId), code('RECEIPT_NOT_FOUND'), 'a new count deletes the one before');
  assert.deepEqual(bandReceipts(env).map(item => item.id), [hidden.bands!.receiptId]);
  assert.equal(p.hidden, false);

  const empty = await setup();
  assert.equal((await net<NetworkSourcesView>(empty, 'venture.network.sources', {})).bands, null, 'no ties, no bands');
});

test('venture.network.know adds the "you said" signal with the owner as the source, once per person, and works the tie out again', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  const farhan = personNamed(env, 'Farhan Ali');
  const before = tieOf(env, farhan.id);
  await assert.rejects(net(env, 'venture.network.know', { personId: farhan.id, how: 'well' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.network.know', { personId: farhan.id, how: 'friends' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.know', { personId: 'person_nobody', how: 'well' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.know', { personId: farhan.id, how: 'well', note: 'one\ntwo' }), code('INVALID_VENTURE_REQUEST'));

  const view = await net<PersonView>(env, 'venture.network.know', { personId: farhan.id, how: 'well', note: 'We ran the spice stall together' });
  assert.equal(view.person.band, 'know-well', 'the owner\'s own word that they know him well is strong evidence');
  const tie = tieOf(env, farhan.id);
  assert.notEqual(tie.id, before.id, 'a changed tie is a new receipt');
  const said = tie.signals.find(signal => signal.kind === 'you-said')!;
  assert.deepEqual([said.count, said.last, said.weightBp, said.decayedBp, said.source], [1, '2026-10-23', 1800, 1800, 'You, in Chausar']);
  assert.equal(said.line, 'You said you know Farhan well, on 23 Oct 2026', 'the note stays on the person, not copied into the tie');
  assert.ok(view.how.some(item => item.line === `${said.line} (You, in Chausar)` && item.receiptId === tie.id));
  const stored = personNamed(env, 'Farhan Ali');
  const facts = stored.facts.filter(fact => fact.kind === 'you-said');
  assert.equal(facts.length, 1);
  assert.deepEqual([facts[0].source, facts[0].date, facts[0].detail], [{ connector: 'owner', importId: null, row: null }, '2026-10-23', { how: 'well', note: 'We ran the spice stall together' }]);
  assert.deepEqual(stored.history.at(-1), { op: 'know', from: [], at: env.now(), by: 'owner' });
  assert.ok(view.fields.some(field => field.field === 'You said' && field.source === 'You, in Chausar'), 'what Chausar keeps names the owner as the source');
  const row = evidenceOf(env, farhan.id).find(item => item.field === 'tie.you-said')!;
  assert.deepEqual([row.type, row.by, row.applied], ['owner-entered', 'engine', true]);

  const met = await net<PersonView>(env, 'venture.network.know', { personId: farhan.id, how: 'met' });
  assert.equal(personNamed(env, 'Farhan Ali').facts.filter(fact => fact.kind === 'you-said').length, 1, 'the newest word replaces the earlier one');
  assert.ok(met.how.some(item => item.line.startsWith('You said you have met Farhan, on 23 Oct 2026')));
  assert.deepEqual([met.person.band, tieOf(env, farhan.id).signals.find(signal => signal.kind === 'you-said')!.weightBp], ['met-once', 500]);
  // A tie worked out again since says so, in its own words, never as a missing price receipt.
  await assert.rejects(receipt(env, before.id), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'RECEIPT_NOT_FOUND');
    assert.equal(error.message, 'How well you know this person was worked out again since. Open the person to see how it stands now.');
    return true;
  });
});

test('the owner\'s word does not fade, and the journal sweep works every tie out again once a day, writing only what changed', async () => {
  const env = await setup();
  toOct23(env);
  const p = await priya(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  const farhan = personNamed(env, 'Farhan Ali').id;
  await net(env, 'venture.network.know', { personId: farhan, how: 'well' });
  const keeperRan = () => env.published.flat().filter(event => event.name === 'keeper.ran' && JSON.stringify(event.data).includes('network-strength')).length;
  const strengthRun = () => listRecords(env.store.read(), 'venture-keeper-run').filter(run => run.job === 'network-strength');
  const stored = () => JSON.stringify([listRecords(env.store.read(), 'venture-tie'), listRecords(env.store.read(), 'venture-evidence'), strengthRun()]);

  // The same day: the run is fresh, so the sweep writes nothing about ties.
  const before = { state: stored(), ran: keeperRan() };
  await sweepWholeJournal(env.deps, owner);
  assert.equal(stored(), before.state);
  assert.equal(keeperRan() - before.ran, 0);

  // 200 days on: Priya's mail and meetings have faded, so her tie is written anew; Farhan's word has not.
  const priyaTie = tieOf(env, p.id), farhanTie = tieOf(env, farhan);
  env.advance(200 * 86_400_000);
  await sweepWholeJournal(env.deps, owner);
  assert.notEqual(tieOf(env, p.id).id, priyaTie.id);
  assert.deepEqual([tieOf(env, p.id).scoreBp, tieOf(env, p.id).band], [1367, 'know'], '2,400 and 600 faded over 203 and 208 days: 1,098 and 269');
  assert.equal(tieOf(env, farhan).id, farhanTie.id, 'nothing changed for Farhan, so his tie is not written again');
  assert.deepEqual(tieOf(env, farhan).signals.find(signal => signal.kind === 'you-said')!.decayedBp, 1800);
  const [run] = strengthRun();
  assert.equal(strengthRun().length, 1, 'one record for the job, renewed');
  assert.deepEqual([run.at, run.outcome], [env.now(), 'ok']);
  assert.match(run.line, /^Worked out how well you know 2 people: .*1 changed\.$/);
  assert.equal(keeperRan() - before.ran, 1);
  const served = await receipt<TieReceipt>(env, tieOf(env, farhan).id);
  assert.match(served.explanation, /You said you know Farhan well, on 23 Oct 2026 \(You, in Chausar\): 1,800 once; your own word does not fade\./);
  assert.match(served.explanation, /What you said yourself does not fade until you change it\./);

  // An hour later: not due again, nothing written.
  const settled = stored();
  env.advance(60 * 60_000);
  await sweepWholeJournal(env.deps, owner);
  assert.equal(stored(), settled);

  // A business with no one in its network: the sweep writes no network-strength run at all.
  const empty = await setup();
  await sweepWholeJournal(empty.deps, owner);
  assert.equal(listRecords(empty.store.read(), 'venture-keeper-run').some(item => item.job === 'network-strength'), false);
});

test('a tie reads stale once what it rests on changes elsewhere (an invoice issued since), until it is worked out again', async () => {
  const env = await setup();
  toOct23(env);
  const { client } = await seedPayingClient(env, 'Asha Rao', 'asha.office@dewdrop.example', '2026-10-01');
  await ventureAction(env.deps, owner, 'admin', 'seed.void', tx => {
    for (const invoice of tx.list('venture-invoice')) if (invoice.clientId === client.id) tx.replace({ ...invoice, status: 'void' });
  });
  await net(env, 'venture.network.recompute', {});
  const asha = personNamed(env, 'Asha Rao');
  const before = tieOf(env, asha.id);
  assert.deepEqual(before.signals, [], 'a client with no invoice is not yet a paying client');
  assert.equal(before.band, 'cold');
  assert.equal((await receipt<TieReceipt>(env, before.id)).stale, false);
  assert.deepEqual((await net<PersonView>(env, 'venture.network.person', { id: asha.id })).how, [{ line: 'Nothing in your files shows how you know Asha yet.', receiptId: before.id }]);
  await ventureAction(env.deps, owner, 'admin', 'seed.issue', tx => {
    tx.put({ ...tx.base('venture-invoice'), clientId: client.id, orderId: 'order_seed', status: 'issued', issueDate: '2026-10-20', number: 'INV-0002' } as never);
  });
  assert.equal((await receipt<TieReceipt>(env, before.id)).stale, true, 'an invoice issued since: the tie no longer says all there is');
  await net(env, 'venture.network.recompute', {});
  const fresh = tieOf(env, asha.id);
  assert.deepEqual([fresh.band, (await receipt<TieReceipt>(env, fresh.id)).stale], ['know', false]);
});

test('a merge, a split and an Undo work the ties out again, so no band claims what the files no longer show', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Asha,Rao,https://www.linkedin.com/in/asha-rao,asha@dewdrop.example,Dewdrop Naturals,Co-founder,02 Oct 2026']));
  const contacts = await imported(env, 'contacts-csv', 'contacts.csv', 'Name,E-mail 1 - Value,Organization 1 - Name\nAsha Rao,asha.home@mail.example,Dewdrop Naturals\n');
  const [a, b] = people(env).filter(item => item.name === 'Asha Rao').map(item => item.id);
  await net(env, 'venture.network.merge', { a, b });
  assert.deepEqual(tieOf(env, a).signals.map(signal => signal.kind), ['contact', 'linkedin-connection']);
  assert.equal(listRecords(env.store.read(), 'venture-evidence').filter(row => row.subject === `person:${a}` && row.field === 'tie.contact').length, 1, 'one row per signal after a merge too');

  const mail = await imported(env, 'mail-headers', 'takeout.mbox', mailFile(bothWays('Asha Rao <asha@dewdrop.example>', ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])));
  assert.equal(tieOf(env, a).band, 'know-well');
  await net(env, 'venture.network.importUndo', { importId: mail.import.id });
  assert.equal(tieOf(env, a).band, 'met-once', 'the mail is gone, and so is the strength it gave');

  const split = await net<{ person: PersonView; split: PersonView }>(env, 'venture.network.split', { personId: a, sourceIds: [contacts.import.id] });
  assert.deepEqual(tieOf(env, a).signals.map(signal => signal.kind), ['linkedin-connection']);
  assert.deepEqual(tieOf(env, split.split.person.id).signals.map(signal => signal.kind), ['contact']);
  assert.equal(split.person.person.band, 'cold');
});

test('the bands count names no one, so after Forget the person is stored nowhere, the old count included', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  const p = await priya(env);
  const first = (await net<NetworkSourcesView>(env, 'venture.network.sources', {})).bands!.receiptId;
  await net(env, 'venture.network.forget', { id: p.id });
  const stored = JSON.stringify(env.store.read().conversations);
  for (const trace of ['Priya', 'priya@acme.example', p.id]) assert.ok(!stored.includes(trace), `${trace} is stored nowhere`);
  const old = await receipt(env, first).then(served => JSON.stringify(served), (error: { code?: string }) => error.code ?? 'refused');
  assert.ok(!old.includes('Priya') && !old.includes(p.id), 'the count read before Forget says nothing about her');
  const after = (await net<NetworkSourcesView>(env, 'venture.network.sources', {})).bands!;
  assert.deepEqual([after.close, after.cold], [0, 1]);
  assert.deepEqual(bandReceipts(env).map(item => item.id), [after.receiptId], 'one count kept, the newest');
});

test('a meeting after the day the file is read adds nothing: the file drops and counts it, and no tie, line or path comes from it', async () => {
  const env = await setup();
  toOct23(env);
  const read = await imported(env, 'calendar-ics', 'work.ics', ics([
    { day: '2026-10-12', title: 'Acme samples', people: ['priya@acme.example'] },
    { day: '2026-10-30', title: 'Acme launch', people: ['priya@acme.example', 'rahul@ubtan.example'] },
    { day: '2026-11-05', title: 'Ubtan review', people: ['rahul@ubtan.example'] },
  ]));
  assert.deepEqual(read.import.dropped, [{ what: 'Meetings after the day the file was read', count: 2 }]);
  assert.equal(people(env).some(item => item.handles.emails.includes('rahul@ubtan.example')), false, 'someone only in meetings still to come is not added');
  const p = people(env).find(item => item.handles.emails.includes('priya@acme.example'))!;
  const [meeting] = tieOf(env, p.id).signals;
  assert.deepEqual([meeting.kind, meeting.count, meeting.last], ['meeting', 1, '2026-10-12']);

  // A file read on a computer whose clock ran ahead (1 Dec): months after today count for nothing, and the meetings'
  // "who else came" is dropped, so no path comes from a meeting still to come.
  const ahead = projected('calendar-ics', ics([
    { day: '2026-10-14', title: 'Neem catalogue', people: ['sameer@neem.example'] },
    { day: '2026-11-20', title: 'Neem launch', people: ['sameer@neem.example', 'vikram@neem.example'] },
  ]), { today: '2026-12-01' });
  const late = await imported(env, 'calendar-ics', 'ahead.ics', ahead);
  assert.ok(late.import.dropped.some(item => item.what === 'Who came to meetings dated after today'));
  const sameer = people(env).find(item => item.handles.emails.includes('sameer@neem.example'))!;
  const vikram = people(env).find(item => item.handles.emails.includes('vikram@neem.example'))!;
  const signal = tieOf(env, sameer.id).signals.find(item => item.kind === 'meeting')!;
  assert.deepEqual([signal.count, signal.last, signal.line], [1, '2026-10-01', '1 small meeting, the last in Oct 2026']);
  assert.deepEqual(tieOf(env, vikram.id).signals, [], 'a meeting still to come is no signal');
  await net(env, 'venture.network.know', { personId: vikram.id, how: 'well' });
  assert.ok(!(await net<PersonView>(env, 'venture.network.person', { id: sameer.id })).paths.some(path => path.via?.id === vikram.id));
});

test('the evidence rows come through the ledger\'s helper for person evidence: the secret screen and the caps apply, and only person subjects', async () => {
  const env = await setup();
  toOct23(env);
  const key = ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2m3'].join('_');
  assert.notEqual(redactSecrets(key), key, 'the fixture is shaped like a key');
  await imported(env, 'mail-headers', `export ${key}.mbox`, mailFile(PRIYA_MAIL));
  const p = personNamed(env, 'Priya Nair');
  const stored = JSON.stringify(env.store.read().conversations.filter(record => record.kind === 'venture-tie' || record.kind === 'venture-evidence'));
  assert.ok(!stored.includes(key), 'no key in a tie or an evidence row');
  const [row] = evidenceOf(env, p.id);
  assert.equal(row.type, 'engine-computed');
  await ventureAction(env.deps, owner, 'admin', 'probe', tx => {
    assert.throws(() => personEvidence(tx, { personId: 'client:x', field: 'tie.contact', value: 'v', source: 's', ownerSaid: false }), code('INVALID_VENTURE_REQUEST'));
    assert.throws(() => personEvidence(tx, { personId: p.id, field: 'tie.__proto__', value: 'v', source: 's', ownerSaid: false }), code('INVALID_VENTURE_REQUEST'));
    const long = personEvidence(tx, { personId: p.id, field: 'tie.contact', value: 'x'.repeat(900), source: 'y'.repeat(400), ownerSaid: false });
    assert.deepEqual([long.subject, long.value.length, long.type, long.strength, long.applied, long.by], [`person:${p.id}`, 500, 'engine-computed', 'verified', true, 'engine']);
    assert.ok(long.source.length <= 180);
    const said = personEvidence(tx, { personId: p.id, field: 'tie.you-said', value: 'You said so', source: 'You, in Chausar', ownerSaid: true });
    assert.deepEqual([said.type, said.source], ['owner-entered', 'You entered this: You, in Chausar']);
  });
});

test('a date that cannot be read leaves that one signal out and never stops an import', async () => {
  const env = await setup();
  toOct23(env);
  const { person: neha, client } = await seedPayingClient(env, 'Neha Shah', 'neha@shah.example', '2026-13-45');
  await ventureAction(env.deps, owner, 'admin', 'seed.bad', tx => {
    const stored = tx.find('venture-person', neha.id)!;
    tx.replace({ ...stored, facts: [...stored.facts, { id: 'bad.1', kind: 'connection', value: 'LinkedIn connection', date: 'soon', detail: null, source: { connector: 'owner', importId: null, row: null } }] });
    tx.put({ ...tx.base('venture-invoice'), clientId: client.id, orderId: 'order_seed', status: 'issued', issueDate: '2026-10-20', number: 'INV-0003' } as never);
  });
  const done = await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv(['Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026']));
  assert.equal(done.mode, 'import');
  const signals = tieOf(env, neha.id).signals;
  assert.deepEqual(signals.map(signal => [signal.kind, signal.last]), [['client', '2026-10-20']], 'the unreadable invoice day and connection day are left out');
});

test('through the host: recompute is prepare level from any channel, know and link only inside the app, and a tie receipt is a read', async () => {
  const env = await setup();
  toOct23(env);
  (env.store as unknown as { derivedKey: (purpose: string) => Buffer }).derivedKey = purpose => createHash('sha256').update(`test vault key:${purpose}`).digest();
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: [] }); });
  const viewer = { memberId: 'viewer', role: 'viewer' as const, epoch: 1, channel: 'desktop' as const };
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test' });
  try {
    assert.deepEqual([W4_METHOD_LEVELS['venture.network.recompute'], W4_METHOD_LEVELS['venture.network.know'], W4_METHOD_LEVELS['venture.network.link']], ['prepare', 'prepare', 'prepare']);
    assert.deepEqual([APP_ONLY_METHODS.includes('venture.network.recompute'), APP_ONLY_METHODS.includes('venture.network.know'), APP_ONLY_METHODS.includes('venture.network.link')], [false, true, true]);
    await host.request(owner, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: connectionsCsv([
      'Farhan,Ali,https://www.linkedin.com/in/farhan-ali,,Ali Spices,Owner,20 Oct 2026', 'Meera,Das,https://www.linkedin.com/in/meera-das,,Dewdrop Naturals,Designer,10 Jan 2025',
    ]) });
    const [farhan, meera] = ['Farhan Ali', 'Meera Das'].map(name => personNamed(env, name).id);
    assert.equal(((await host.request(phone, 'venture.network.recompute', {})) as NetworkRecompute).ties, 2, 'from the phone too');
    await assert.rejects(host.request(viewer, 'venture.network.recompute', {}), code('FORBIDDEN'));
    await assert.rejects(host.request(phone, 'venture.network.know', { personId: farhan, how: 'well' }), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(host.request(phone, 'venture.network.link', { a: farhan, b: meera, note: 'Cousins' }), code('APP_APPROVAL_REQUIRED'));
    const view = await host.request(owner, 'venture.network.know', { personId: farhan, how: 'well' }) as PersonView;
    assert.equal(view.person.band, 'know-well');
    assert.match(((await host.request(owner, 'venture.network.link', { a: farhan, b: meera, note: 'Cousins' })) as { line: string }).line, /^Saved: /);
    const tieId = tieOf(env, farhan).id;
    for (const ctx of [owner, phone, viewer]) assert.equal(((await host.request(ctx, 'venture.receipt.get', { id: tieId })) as TieReceipt).operation, 'venture.tie');
  } finally {
    host.close();
  }
});
