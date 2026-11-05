// One-shot B2, the task after task 3 (the founder's answer of 5 Nov): the engine spots that took "today" as the UTC
// day now take the owner's day, by the business's country and the engine's own zone table (local-day.ts). At 00:30 in
// India on 22 Oct, UTC still says 21 Oct; the owner's day is 22 Oct.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { applySiteEdit, localFolderTarget, stageSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { ventureTimeZone } from '../runtime/venture/local-day.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
/** 00:30 in India on 22 Oct 2026; UTC is still on 21 Oct. */
const LATE = Date.parse('2026-10-21T19:00:00.000Z');

async function seeded(country: { code: string } | null) {
  const store = new VentureTestStore();
  const deps = { store, clock: () => new Date(LATE) } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  return deps;
}

async function readBackDay(country: { code: string } | null): Promise<string | undefined> {
  const root = await mkdtemp(join(tmpdir(), 'chausar-owner-today-'));
  try {
    await writeFile(join(root, 'index.html'), '<p>Open 9 to 5</p>');
    const deps = await seeded(country);
    const target = await localFolderTarget(root);
    const staged = await stageSiteEdit(deps, owner, target, { path: 'index.html', after: '<p>Open 8 to 6</p>', summary: 'New hours' });
    await applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    const entry = listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.action === 'site.apply')!;
    return entry.ends?.at(-1)?.check?.checkedOn;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a website read back at 00:30 in India is dated the owner\'s day, not the UTC day', async () => {
  assert.equal(await readBackDay({ code: 'IN' }), '2026-10-22');
  assert.equal(await readBackDay({ code: 'US' }), '2026-10-21');
  // A business still in its interview has no country yet: the engine's fallback, UTC, as before.
  assert.equal(await readBackDay(null), '2026-10-21');
  assert.equal(ventureTimeZone(null), 'UTC');
});

test('none of the listed spots reads the UTC day or a fixed India offset any more', () => {
  const root = join(import.meta.dirname, '../runtime/venture');
  for (const file of [
    'delivery/runs.ts', 'playbooks/social/run-guard.ts', 'build/site-edits.ts', 'agent-runtime/native-job.ts',
    'playbooks/online-seller/photos-desk.ts', 'playbooks/online-seller/model.ts',
    // Found while building: the journal refused an owner's-day check as dated after today.
    'journal/end-states.ts',
  ]) {
    const text = readFileSync(join(root, file), 'utf8');
    // Tested with .test so a failure names the file, not the whole file's text.
    assert.ok(!/(?:clock\(\)|new Date\(\)|Date\.now\(\)[^;]*)\.toISOString\(\)\.slice\(0, ?10\)/.test(text), file);
    assert.ok(!/tx\.now\.slice\(0, ?10\)/.test(text), file);
    assert.ok(!/19800000|330 \* 60/.test(text), file);
  }
});

// B2 fix round 1 (spec 5, quality 7): one owner-day rule across venture/ (build/ included). A day or month the owner
// reads comes from the injected clock in the business's zone (local-day.ts localDayAt, ownerToday, todayLocal). These
// shapes read the UTC day of an instant or the computer's own clock instead; each place left is listed with its reason.
// B2 fix round 2: `now` in every shape, a value (tx.now, current.now) or a call (env.now(), deps.now()), sliced or
// through toISOString.
const UTC_DAY = /\bnow(?:\(\))?\.slice\(0, ?(?:7|10)\)|(?:clock\(\)|\bnow\(\)|new Date\(\)|Date\.now\(\)\))\.toISOString\(\)\.slice\(0, ?(?:7|10)\)|(?:\bat|\.at|At|Iso|iso)\.slice\(0, ?(?:7|10)\)|\bDate\.now\(\)|localDayAt\(new Date\(\)/g;
const UTC_DAY_PLACES: Readonly<Record<string, readonly [count: number, why: string]>> = {
  // The spend calendar: every AI spend cap, meter and spend line counts by the UTC month of each spend, one rule for
  // the engine and the fake. Moving it to the owner's month is a separate decision (caps would reset at the owner's
  // midnight on the 1st); see the B2 fix round 1 notes.
  'agent-runtime/billing.ts': [3, 'the spend calendar (UTC month)'],
  'models/budget.ts': [2, 'the spend calendar (UTC month)'],
  'models/port.ts': [1, 'the spend calendar (UTC month)'],
  'money/agent-meters.ts': [1, 'the spend calendar (UTC month)'],
  'money/spend-meter.ts': [1, 'the spend calendar (UTC month)'],
  'money/spend.ts': [1, 'the spend calendar (UTC month)'],
  'money/across.ts': [1, "the summary's AI spend line, on the spend calendar (UTC month)"],
  'money/overview.ts': [1, "Money's spend line, on the spend calendar (UTC month)"],
  'views/team-series.ts': [1, "Team's spend series, on the spend calendar (UTC month)"],
  'build/storefront-assistant-model.ts': [1, "the shop assistant's model budget, on the spend calendar (UTC month)"],
  'money/department-spend.ts': [1, "the department spend split, on the spend calendar (its comment says so)"],
  'agents/talk-core.ts': [1, "the voice provider's monthly spend, on the spend calendar (UTC month)"],
  'playbooks/kit/define.ts': [1, "a playbook's dated rules checked once when it loads, before any business is open"],
  // Elapsed time and deadlines, never a day.
  'agent-runtime/runner.ts': [6, 'elapsed time and timeouts'],
  'build/browser.ts': [5, 'elapsed time and timeouts'],
  'build/fetch-policy.ts': [3, 'elapsed time and timeouts'],
  'build/monitors.ts': [2, 'elapsed time and timeouts'],
  'build/posting.ts': [1, 'a click deadline'],
  'build/storefront-widget-page.ts': [1, "the buyer's own browser clock in the widget page script"],
  'core/net-guard.ts': [4, 'elapsed time and timeouts'],
  'models/login.ts': [5, 'elapsed time and timeouts'],
  'playbooks/monitored-data/schedule.ts': [2, 'a time budget for one round of looks'],
  'playbooks/seo-visibility/monitor-desk.ts': [3, 'a request deadline'],
  'web/reader.ts': [1, "the page cache's age"],
  'network/extract-calendar.ts': [1, 'the fallback when the caller gives no day; the callers pass the owner day'],
  // A stamp's own calendar day, or a day written into text the AI and the client read.
  'delivery/research-rules.ts': [2, "a citation's read-on day in research text (review spec 7)"],
  'build/bank.ts': [2, "the bank consent's own expiry day as the bank stamped it"],
  'build/connector-check.ts': [1, "the bank consent's own expiry day as the bank stamped it"],
  'build/share-links.ts': [2, "a link's own expiry day as it was stamped"],
  'playbooks/kit/report/share.ts': [2, 'a calendar day already written YYYY-MM-DD, formatted'],
  'playbooks/youtube/data-api.ts': [1, "YouTube's own published day"],
  'money/dates.ts': [1, 'calendar arithmetic on a day string'],
  'playbooks/social/risk-gate.ts': [1, "a platform rule's checked-on age, not a business day"],
  // LEFT in this round (B2 fix round 1 notes): each still takes the transaction's UTC day.
  'playbooks/monitored-data/extract.ts': [4, 'LEFT: a watched page read day'],
  'playbooks/monitored-data/check.ts': [1, 'LEFT: a watched page read day'],
  'playbooks/monitored-data/state.ts': [2, 'LEFT: a watched page read day'],
  'playbooks/online-seller/model.ts': [1, 'LEFT: a pure seller calculator called with no day (the desk and the harness now pass the owner day)'],
};

test('under venture/, no UTC day of now or of the computer clock outside the listed places (owner-day rule)', () => {
  const root = join(import.meta.dirname, '../runtime/venture');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []; });
  const found = walk(root).map(path => [relative(root, path).split(sep).join('/'), (readFileSync(path, 'utf8').match(UTC_DAY) ?? []).length] as const)
    .filter(([f, count]) => count !== (UTC_DAY_PLACES[f]?.[0] ?? 0)).map(([f, count]) => `${f}: ${count}, listed ${UTC_DAY_PLACES[f]?.[0] ?? 0}`);
  assert.deepEqual(found, []);
});

test("a run's consent check at 00:30 in India reads the owner's day: a consent until 21 Oct no longer holds on 22 Oct", async () => {
  const { requireOrderPeopleConsent, todayOf } = await import('../runtime/venture/playbooks/kit/voice-consent.ts');
  for (const [code, holds] of [['IN', false], ['US', true]] as const) {
    const deps = await seeded({ code });
    await ventureAction(deps, owner, 'admin', 'consent', tx => tx.put({
      ...tx.base('venture-voice-consent'), speaker: 'Asha', version: 1, until: '2026-10-21', revokedAt: null, updatedAt: tx.now,
    } as any), { create: true });
    const state = deps.store.read(), venture = listRecords(state, 'venture-record')[0]!;
    const consentId = listRecords(state, 'venture-voice-consent', venture.id)[0]!.id;
    const order = { intake: { fields: { people: [{ name: 'Asha', consentId }] } } } as any;
    // The day the run guard is given (delivery/runs.ts: todayOf(venture, deps.clock())).
    const today = todayOf(venture, deps.clock());
    assert.equal(today, code === 'IN' ? '2026-10-22' : '2026-10-21');
    const check = () => requireOrderPeopleConsent(state, venture, order, today);
    if (holds) assert.doesNotThrow(check); else assert.throws(check, { code: 'CONSENT_REQUIRED' });
  }
});

// B2 fix round 2: the recruiting report's day (round-core.ts, ledger.ts) was the UTC day of the desk's clock, and each
// candidate and message was counted by its UTC day. At 00:30 in India the report said yesterday and counted yesterday's
// people as today's.
test("the recruiting report at 00:30 in India is the owner's day and counts that day's candidates only", async () => {
  const { setup, seedBlueprint, seedOrder, owner: deskOwner } = await import('./venture-views-env.ts');
  const { RECRUITING_DESK_DESK } = await import('../runtime/venture/playbooks/recruiting-desk/desk.ts');
  const env = await setup(), { order } = await seedOrder(env, await seedBlueprint(env));
  const act = (kind: string, id: string, action: string, payload: unknown, digest?: string) => RECRUITING_DESK_DESK[kind]!.act!(env.deps, deskOwner,
    { playbook: 'recruiting-desk', kind, id, action, payload: payload as any, ...(digest ? { digest } : {}) });
  const get = (kind: string, id: string) => RECRUITING_DESK_DESK[kind]!.get!(env.deps, deskOwner, { playbook: 'recruiting-desk', kind, id });
  const answers = { roleTitle: 'SQL analyst', location: 'Pune', payRange: 'Client to confirm', hardRules: ['SQL reporting'], mustHaves: ['Report design | A work sample'],
    exclusions: [], targetCompanies: [], searchWords: ['SQL'], privacyNoticeUrl: 'https://client.example/privacy', retentionDays: '90' };
  const made = await act('role', 'new', 'create', { serviceOrderId: order.id });
  for (const [questionId, value] of Object.entries(answers)) await act('role', made.id, 'answer', { questionId, value });
  let role = await get('role', made.id);
  for (const c of (role.item as any).brief.criteria) { await act('role', made.id, 'approve-rule', { criterionId: c.id }, role.digest); role = await get('role', made.id); }
  // 23:30 in India on 15 Oct (18:00 UTC): a candidate is added.
  env.advance(Date.parse('2026-10-15T18:00:00.000Z') - Date.parse(env.now()));
  await act('candidate', 'new', 'add', { roleId: made.id, name: 'Dev', email: null, resume: 'SQL reports', sourceUrl: null });
  // An hour later it is 00:30 on 16 Oct in India; UTC still says 15 Oct.
  env.advance(60 * 60 * 1000);
  const report = ((await act('role', made.id, 'report', {})).result as any).data;
  assert.equal(report.day, '2026-10-16');
  assert.equal(report.tiles.newCandidates, 0);
});
