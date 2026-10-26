// Ink v2 wave 4, package 4G1 (O12, spec 5.7): the notification centre. One chokepoint (notify.refresh) writes one
// venture-notification per needs-you subject, never twice; notify.new carries a count only; the centre lists items
// newest first and marks them read; the owner's settings (pause, quiet hours, digest hour, push, tray) and the pacing
// rules for alerts outside the app: needs-you only, once each, nothing while the owner watches, quiet hours hold then
// send one count, urgent items pass quiet hours at most 6 a day, and 10, 30, then 60 minutes between alerts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ventureAction, listRecords } from '../runtime/venture/records.ts';
import type { Context } from '../runtime/contracts.ts';
import type {
  NotificationRecord, NotifyListView, NotifySettingsRecord, NotifySettingsView, QueueList, KeeperRunRecord, RoutineRecord,
} from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/notify/index.ts';
import { DEFAULT_NOTIFY_SETTINGS, NOTIFY_PACING, notifyRefresh, planAlert, planRefresh, type AlertInput } from '../runtime/venture/notify/centre.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import {
  CLIENT_NAME, code, harness, IN, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, START, type Env,
} from './venture-views-env.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const notifications = (env: Env) => listRecords(env.store.read(), 'venture-notification', env.venture.id);
const notifyNews = (env: Env) => env.published.flat().filter(event => event.name === 'notify.new');
const notify = <T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> =>
  (handlers as Record<string, (deps: unknown, ctx: Context, payload: unknown) => Promise<unknown>>)[method](env.deps, ctx, payload) as Promise<T>;
const queue = (env: Env) => (views['venture.queue.list'] as (d: unknown, c: Context, p: unknown) => Promise<QueueList>)(env.deps, owner, {});

/** One more needs-you row: a failed draft on a new order, with Run again. */
async function newRow(env: Env, plan: Awaited<ReturnType<typeof seedBlueprint>>) {
  const { order } = await seedOrder(env, plan);
  return seedRun(env, order, { status: 'failed', callId: null });
}

test('one chokepoint: each needs-you row notifies once by its subject, a locked row never, and notify.new carries a count only', async () => {
  const env = await setup();
  env.workspace.others = [{ id: 'b2', name: 'Second shop', opens: 'needs-passphrase', openedAt: null }];
  await seedBlueprint(env, { status: 'draft' });
  env.published.length = 0;
  const result = await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifications(env).map(record => record.subject).sort(), [`plan:${env.venture.id}`, 'setup:ai', 'setup:prices']);
  for (const record of notifications(env)) {
    assert.ok(['plan', 'setup'].includes(record.rowKind));
    assert.equal(record.readAt, null);
    assert.equal(record.digestOn, null);
    assert.equal(record.alert, 'sent');
  }
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: 3 }], 'the event holds the count and nothing else');
  assert.deepEqual(result, { added: 3, alert: { count: 3 }, digest: null });

  // Nothing new: nothing written, nothing said.
  env.published.length = 0;
  assert.deepEqual(await notifyRefresh(env.deps, owner), { added: 0, alert: null, digest: null });
  assert.equal(notifications(env).length, 3);
  assert.deepEqual(notifyNews(env), []);
});

test('the same subject never notifies again across row versions; its newest row id is kept for the link', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(env.deps, owner);
  const plan = notifications(env).find(record => record.subject.startsWith('plan:'))!;
  const before = (await queue(env)).rows.find(row => row.kind === 'plan')!;
  assert.equal(plan.rowId, before.id);
  env.advance(HOUR);
  await seedBlueprint(env, { status: 'draft', version: 2, price2: '100000' });
  const after = (await queue(env)).rows.find(row => row.kind === 'plan')!;
  assert.notEqual(after.id, before.id, 'a new version is a new row id with the same subject');
  env.published.length = 0;
  const result = await notifyRefresh(env.deps, owner);
  assert.equal(result.added, 0);
  assert.equal(notifications(env).filter(record => record.subject === plan.subject).length, 1);
  assert.equal(notifications(env).find(record => record.subject === plan.subject)!.rowId, after.id);
  assert.ok(notifyNews(env).every(event => !Object.hasOwn(event.data as object, 'count')), 'a changed row is not a new alert');
});

test('the centre: venture.notify.list newest first with row id, kind, title, time and read; venture.notify.read by ids or all', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(env.deps, owner);
  env.advance(15 * MIN);
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const run = await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  const list = await notify<NotifyListView>(env, 'venture.notify.list');
  assert.equal(list.items[0].rowId.startsWith(`run:${run.id}`), true, 'newest first');
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['at', 'id', 'kind', 'read', 'rowId', 'title']);
  assert.equal(list.items[0].kind, 'draft');
  assert.equal(list.items[0].title, 'The draft for Cafe Aroma Demo failed');
  assert.equal(list.items[0].at, env.now());
  // The plan was accepted and the prices set, so their rows left Today: they read as read. The other two are new.
  assert.equal(list.unread, 2);
  assert.deepEqual(list.items.map(item => [item.kind, item.read]), [['draft', false], ['setup', true], ['setup', false], ['plan', true]]);
  assert.equal(list.items.find(item => item.rowId.startsWith('setup:prices'))!.read, true);
  assert.equal(list.digest, null);

  const read = await notify<{ unread: number }>(env, 'venture.notify.read', { ids: [list.items[0].id] });
  assert.deepEqual(read, { unread: 1 });
  assert.equal((await notify<NotifyListView>(env, 'venture.notify.list')).items[0].read, true);
  assert.deepEqual(await notify(env, 'venture.notify.read', { all: true }), { unread: 0 });
  assert.equal((await notify<NotifyListView>(env, 'venture.notify.list')).unread, 0);

  for (const bad of [{}, { ids: [] }, { ids: ['notif_x'], all: true }, { all: false }, { ids: 'notif_x' }, { ids: ['notif_missing'] }, { other: 1 }]) {
    await assert.rejects(notify(env, 'venture.notify.read', bad), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  await assert.rejects(notify(env, 'venture.notify.list', { all: true }), code('INVALID_VENTURE_REQUEST'));
});

test('settings: defaults, app only, a pause of 30 days at most, quiet hours, digest hour, push and tray; a partial change keeps the rest', async () => {
  const env = await setup();
  const first = await notify<NotifySettingsView>(env, 'venture.notify.settings', {});
  assert.deepEqual({ ...first, keepsRunning: undefined, line: undefined }, {
    pausedUntil: null, quietHours: { from: '22:00', to: '07:00' }, digest: { hour: 8 }, push: false, tray: true, keepsRunning: undefined, line: undefined,
  });
  assert.deepEqual(DEFAULT_NOTIFY_SETTINGS, { pausedUntil: null, quietHours: { from: '22:00', to: '07:00' }, digest: { hour: 8 }, push: false, tray: true, relay: null });
  assert.match(first.line, /22:00 to 07:00/);
  assert.equal(listRecords(env.store.read(), 'venture-notify-settings').length, 0, 'reading the settings writes nothing');

  await assert.rejects(notify(env, 'venture.notify.settings', { tray: false }, phone), code('APP_APPROVAL_REQUIRED'));
  const tooLong = new Date(Date.parse(START) + 30 * 24 * HOUR + MIN).toISOString();
  await assert.rejects(notify(env, 'venture.notify.settings', { pausedUntil: tooLong }), code('NOTIFY_PAUSE_TOO_LONG'));
  for (const bad of [
    { pausedUntil: '2026-10-14T10:00:00.000Z' }, { pausedUntil: 'tomorrow' }, { quietHours: { from: '22:00', to: '22:00' } },
    { quietHours: { from: '25:00', to: '07:00' } }, { quietHours: { from: '22:00' } }, { digest: { hour: 24 } }, { digest: { hour: 7.5 } },
    { push: 'yes' }, { tray: 1 }, { relay: 'https://ntfy.example/topic' },
  ]) await assert.rejects(notify(env, 'venture.notify.settings', bad), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));

  // The relay (4G3) is the owner's own address: a settings change carries it forward untouched.
  await ventureAction(env.deps, owner, 'approve', 'seed.relay', tx => {
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...DEFAULT_NOTIFY_SETTINGS, relay: 'https://ntfy.example/chausar' });
  });
  const pausedUntil = new Date(Date.parse(START) + 30 * 24 * HOUR).toISOString();
  const paused = await notify<NotifySettingsView>(env, 'venture.notify.settings', { pausedUntil, quietHours: { from: '23:30', to: '06:00' }, digest: null });
  assert.equal(paused.pausedUntil, pausedUntil);
  assert.deepEqual(paused.quietHours, { from: '23:30', to: '06:00' });
  assert.equal(paused.digest, null);
  assert.equal(paused.tray, true);
  assert.match(paused.line, /paused until 14 Nov 2026/);
  const pushed = await notify<NotifySettingsView>(env, 'venture.notify.settings', { push: true, tray: false, pausedUntil: null, digest: { hour: 7 } });
  assert.deepEqual([pushed.push, pushed.tray, pushed.pausedUntil, pushed.digest, pushed.quietHours], [true, false, null, { hour: 7 }, { from: '23:30', to: '06:00' }]);
  const stored = listRecords(env.store.read(), 'venture-notify-settings', env.venture.id).at(-1)!;
  assert.equal(stored.relay, 'https://ntfy.example/chausar');
});

test('settings: what keeps running while the app is closed comes from Keeper\'s runs and the routines that are on', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.keeper', tx => {
    tx.put<KeeperRunRecord>({ ...tx.base('venture-keeper-run'), job: 'journal-sweep', outcome: 'ok', line: 'Nothing was left half done.' });
    tx.put<KeeperRunRecord>({ ...tx.base('venture-keeper-run'), job: 'journal-sweep', outcome: 'ok', line: 'Nothing was left half done.' });
    tx.put<KeeperRunRecord>({ ...tx.base('venture-keeper-run'), job: 'rate-tables', outcome: 'warn', line: 'One table waits.' });
    const routine = { setBy: 'owner' as const, agent: null, prompt: 'Summarise the week.', schedule: { kind: 'weekly', weekday: 1, time: '09:00' } as unknown as RoutineRecord['schedule'] };
    tx.put<RoutineRecord>({ ...tx.base('venture-routine'), ...routine, name: 'Weekly report', on: true, removedAt: null });
    tx.put<RoutineRecord>({ ...tx.base('venture-routine'), ...routine, name: 'Old check', on: false, removedAt: null });
    tx.put<RoutineRecord>({ ...tx.base('venture-routine'), ...routine, name: 'Gone', on: true, removedAt: tx.now });
  });
  const view = await notify<NotifySettingsView>(env, 'venture.notify.settings', {});
  assert.deepEqual(view.keepsRunning, ['Journal sweep, by Keeper', 'Tax rate tables, by Keeper', 'Routine: Weekly report']);
  env.deps.host = 'hosted-web';
  assert.deepEqual((await notify<NotifySettingsView>(env, 'venture.notify.settings', {})).keepsRunning, [], 'nothing runs on the hosted app while it is closed');
});

test('a pause holds every alert, and nothing is replayed when it ends; the centre still lists everything', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  await notify(env, 'venture.notify.settings', { quietHours: null, pausedUntil: new Date(Date.parse(START) + 2 * HOUR).toISOString() });
  env.published.length = 0;
  await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  assert.ok(notifications(env).every(record => record.alert === 'paused'));
  assert.deepEqual(notifyNews(env).map(event => event.data), [{}], 'the bell hears the centre changed; nothing goes outside');
  assert.equal((await notify<NotifyListView>(env, 'venture.notify.list')).items.length, 2);

  env.advance(3 * HOUR);
  env.published.length = 0;
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env), [], 'nothing from the pause comes back');
  await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: 3 }], 'a new item after the pause alerts with the count of what needs you');
});

test('quiet hours hold alerts and send one count when they end, while the centre lists everything', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  await notify(env, 'venture.notify.settings', { quietHours: { from: '22:00', to: '07:00' }, digest: null });
  await notifyRefresh(env.deps, owner);
  // 22:30 in India (17:00 UTC): two new rows wait quietly.
  env.advance(7 * HOUR);
  env.published.length = 0;
  await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env).map(event => event.data), [{}, {}]);
  assert.equal(notifications(env).filter(record => record.alert === null).length, 2);
  assert.equal((await notify<NotifyListView>(env, 'venture.notify.list')).unread, 3);
  // 06:50: still quiet.
  env.advance(8 * HOUR + 20 * MIN);
  env.published.length = 0;
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env), []);
  // 07:05: one count for everything that needs the owner.
  env.advance(15 * MIN);
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: 3 }]);
  assert.ok(notifications(env).every(record => record.alert === 'sent'));
});

test('nothing goes outside while the owner has had Chausar open in the last 2 minutes; only what came while they watched counts as seen', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  await notify(env, 'venture.notify.settings', { quietHours: null });
  // The owner watched until START, then closed the app.
  env.deps.watching = () => START;
  env.published.length = 0;
  await notifyRefresh(env.deps, owner);
  assert.ok(notifications(env).every(record => record.alert === 'seen'), 'it came while the owner was looking');
  assert.deepEqual(notifyNews(env).map(event => event.data), [{}]);
  // Within the 2 minutes after: a new item waits; it was never on screen, so it is not seen.
  env.advance(NOTIFY_PACING.watchingMs - 1000);
  const late = await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  assert.equal(notifications(env).filter(record => record.alert === 'seen').length, 1);
  assert.equal(notifications(env).find(record => record.subject === `run:${late.id}`)!.alert, null, 'held, not seen');
  // The 2 minutes are over: the held item and the next one alert together, with the count of all that need the owner.
  env.advance(2000);
  env.published.length = 0;
  await newRow(env, plan);
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: 3 }]);
  assert.deepEqual(notifications(env).map(record => record.alert), ['seen', 'sent', 'sent']);
});

test('an item that leaves Today and comes back is news again: a second draft plan after the first was accepted', async () => {
  const env = await setup();
  await notify(env, 'venture.notify.settings', { quietHours: null });
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(env.deps, owner);
  const plans = () => notifications(env).filter(record => record.subject === `plan:${env.venture.id}`);
  assert.equal(plans()[0].alert, 'sent');
  env.advance(HOUR);
  await seedBlueprint(env, { price2: '1500000' }); // accepted: the plan row leaves Today
  await notifyRefresh(env.deps, owner);
  assert.equal(plans().length, 1);
  assert.notEqual(plans()[0].readAt, null);
  assert.equal(plans()[0].title, 'Your plan', 'once it left Today the item keeps a kind word, not its words');
  env.advance(3 * HOUR);
  env.published.length = 0;
  await seedBlueprint(env, { status: 'draft', version: 3, price2: '1700000' }); // a new plan to approve, same subject
  await notifyRefresh(env.deps, owner);
  assert.equal(plans().length, 2, 'a new item for the new episode; the first stays as history');
  const [, second] = plans();
  assert.deepEqual([second.readAt, second.alert, second.at], [null, 'sent', env.now()]);
  const open = (await queue(env)).rows.length;
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: open }]);
  const list = await notify<NotifyListView>(env, 'venture.notify.list');
  assert.equal(list.items[0].id, second.id);
  assert.equal(list.unread, open);
});

test('a run that waits on the owner again is news again; once its row leaves Today no name stays, and old items go after 30 days', async () => {
  const env = await setup();
  await notify(env, 'venture.notify.settings', { quietHours: null, digest: null });
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  env.models.connected = true;
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const ask = (n: number) => ({ to: 'owner' as const, question: `Which bank account is number ${n}?`, turn: n, answer: null, answeredBy: null });
  const run = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer', harness: harness({ phase: 'needs-answer', handoffs: [ask(1)] }),
  }, ['run.waiting']);
  await notifyRefresh(env.deps, owner);
  const episodes = () => notifications(env).filter(record => record.subject === `run:${run.id}`);
  assert.deepEqual(episodes().map(record => record.alert), ['sent']);
  assert.match(episodes()[0].title, new RegExp(CLIENT_NAME));
  // The owner answered on the run sheet (no Today decision); a quarter of an hour later the agent asks again.
  env.advance(15 * MIN);
  env.published.length = 0;
  await ventureAction(env.deps, owner, 'prepare', 'seed.second', tx => {
    const stored = tx.find('venture-delivery-run', run.id)!;
    tx.replace({ ...stored, harness: harness({ phase: 'needs-answer', handoffs: [{ ...ask(1), answer: 'The HDFC one.', answeredBy: 'owner' }, ask(2)] }) });
    tx.emit('run.waiting', { runId: run.id });
  });
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(episodes().map(record => [record.alert, record.readAt === null]), [['sent', false], ['sent', true]]);
  assert.deepEqual(notifyNews(env).map(event => event.data), [{ count: (await queue(env)).rows.length }]);
  assert.equal(episodes()[0].title, 'A question', 'the first wait is over: its words, and the client\'s name, are gone');
  // The run is accepted: its row leaves Today, and no item in the centre keeps the client's name.
  await ventureAction(env.deps, owner, 'prepare', 'seed.done', tx => { tx.replace({ ...tx.find('venture-delivery-run', run.id)!, status: 'accepted' }); });
  await notifyRefresh(env.deps, owner);
  assert.ok(notifications(env).every(record => !record.title.includes(CLIENT_NAME)));
  assert.ok((await notify<NotifyListView>(env, 'venture.notify.list')).items.every(item => !item.title.includes(CLIENT_NAME)));
  // 30 days after an item left Today, it is gone.
  env.advance(30 * 24 * HOUR + MIN);
  await notifyRefresh(env.deps, owner);
  assert.deepEqual(episodes(), []);
});

test('a refresh with nothing new writes nothing: no commit, no revision, no activity line', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  await notifyRefresh(env.deps, owner);
  const state = env.store.read();
  const before = { commits: env.store.commits, revision: state.revision, activity: state.activity.length };
  for (let i = 0; i < 5; i++) { env.advance(MIN); await notifyRefresh(env.deps, owner); }
  const after = env.store.read();
  assert.deepEqual({ commits: env.store.commits, revision: after.revision, activity: after.activity.length }, before);
});

test('a refresh reads Today once: an item written after that look is never marked read by it', async () => {
  const env = await setup();
  await notifyRefresh(env.deps, owner);
  const rowsAt = env.now();
  env.advance(MIN);
  // Another look, newer than this one's rows, wrote an item this one never saw.
  await ventureAction(env.deps, owner, 'read', 'seed.newer', tx => {
    tx.put<NotificationRecord>({
      ...tx.base('venture-notification'), subject: 'run:delivery_newer', rowId: 'run:delivery_newer:failed', rowKind: 'draft', title: 'A newer row',
      readAt: null, alertedAt: null, digestOn: null, expiresAt: null, alert: null,
    });
  });
  const state = env.store.read();
  const plan = planRefresh(state, { venture: env.venture, rows: [], rowsAt, now: env.now(), host: 'test', watchingAt: null, ready: null });
  assert.ok(!plan.changed.some(record => record.subject === 'run:delivery_newer'));
  assert.ok(plan.changed.some(record => record.subject === 'setup:ai' && record.endedAt === env.now()), 'one it saw before its look ends');
});

test('pacing (planAlert): 10, then 30, then 60 minutes between alerts while the owner stays away; opening the app starts again', () => {
  const t0 = Date.parse('2026-10-15T06:00:00.000Z'); // 11:30 in India
  const base = (now: number, records: NotificationRecord[], watchingAt: string | null = null): AlertInput => ({
    now: new Date(now).toISOString(), country: IN, host: 'desktop', settings: { ...DEFAULT_NOTIFY_SETTINGS }, records, digests: [],
    open: new Set(records.map(record => record.subject)), watchingAt, digestDue: false,
  });
  const sentAt = (minutes: number[]) => minutes.map((m, i) => record(`s${i}`, { alert: 'sent', alertedAt: new Date(t0 + m * MIN).toISOString() }));
  const fresh = record('new');
  // No alert yet: at once.
  assert.deepEqual(planAlert(base(t0, [fresh])).alert, { count: 1, urgent: false });
  // One alert: 10 minutes.
  assert.equal(planAlert(base(t0 + 9 * MIN, [...sentAt([0]), fresh])).alert, null);
  assert.deepEqual(planAlert(base(t0 + 10 * MIN, [...sentAt([0]), fresh])).alert, { count: 2, urgent: false });
  // Two alerts: 30 minutes after the last.
  assert.equal(planAlert(base(t0 + 39 * MIN, [...sentAt([0, 10]), fresh])).alert, null);
  assert.ok(planAlert(base(t0 + 40 * MIN, [...sentAt([0, 10]), fresh])).alert);
  // Three or more: 60 minutes.
  assert.equal(planAlert(base(t0 + 99 * MIN, [...sentAt([0, 10, 40]), fresh])).alert, null);
  assert.ok(planAlert(base(t0 + 100 * MIN, [...sentAt([0, 10, 40]), fresh])).alert);
  // The owner opened the app after those alerts: the ladder starts again.
  assert.ok(planAlert(base(t0 + 50 * MIN, [...sentAt([0, 10, 40]), fresh], new Date(t0 + 45 * MIN).toISOString())).alert);
  // Once each: with nothing new, no alert at all.
  assert.equal(planAlert(base(t0 + 5 * HOUR, sentAt([0]))).alert, null);
  // A decided item is not pending: no alert for it.
  assert.equal(planAlert({ ...base(t0, [fresh]), open: new Set() }).alert, null);
  // No outside channel on this computer (the tray is off, no relay): nothing goes out, and it is not saved for later.
  const off = planAlert({ ...base(t0, [fresh]), settings: { ...DEFAULT_NOTIFY_SETTINGS, tray: false } });
  assert.deepEqual([off.alert, off.marks], [null, [{ id: fresh.id, alert: 'off', urgent: false }]]);
  // On the hosted app the channel is push.
  assert.equal(planAlert({ ...base(t0, [fresh]), host: 'hosted-web' }).alert, null);
  assert.ok(planAlert({ ...base(t0, [fresh]), host: 'hosted-web', settings: { ...DEFAULT_NOTIFY_SETTINGS, push: true } }).alert);
});

test('pacing (planAlert): an item expiring within 2 hours passes quiet hours and the wait, at most 6 a day', () => {
  const night = Date.parse('2026-10-15T18:00:00.000Z'); // 23:30 in India, inside 22:00 to 07:00
  const soon = new Date(night + 90 * MIN).toISOString();
  const later = new Date(night + 5 * HOUR).toISOString();
  const input = (records: NotificationRecord[]): AlertInput => ({
    now: new Date(night).toISOString(), country: IN, host: 'desktop', settings: { ...DEFAULT_NOTIFY_SETTINGS }, records, digests: [],
    open: new Set(records.map(item => item.subject)), watchingAt: null, digestDue: false,
  });
  const urgent = record('urgent', { expiresAt: soon });
  const calm = record('calm', { expiresAt: later });
  const plan = planAlert(input([urgent, calm]));
  assert.deepEqual(plan.alert, { count: 2, urgent: true });
  assert.deepEqual(plan.marks, [{ id: urgent.id, alert: 'sent', urgent: true }], 'only the urgent item is told; the calm one waits for the morning');
  assert.equal(planAlert(input([calm])).alert, null);
  // Six urgent alerts already today (India's day): the seventh waits.
  const today = [1, 2, 3, 4, 5, 6].map(i => record(`u${i}`, { alert: 'sent', urgent: true, alertedAt: new Date(night - i * MIN).toISOString() }));
  assert.equal(planAlert({ ...input([...today, urgent]), open: new Set(['urgent']) }).alert, null);
  // Yesterday's do not count.
  const yesterday = today.map(item => ({ ...item, alertedAt: new Date(Date.parse(item.alertedAt!) - 24 * HOUR).toISOString() }));
  assert.ok(planAlert({ ...input([...yesterday, urgent]), open: new Set(['urgent']) }).alert);
  // An item already expired is not urgent.
  assert.equal(planAlert(input([record('gone', { expiresAt: new Date(night - MIN).toISOString() })])).alert, null);
});

let serial = 0;
function record(subject: string, fields: Partial<NotificationRecord> = {}): NotificationRecord {
  serial += 1;
  return {
    id: `notif_${subject}_${serial}`, kind: 'venture-notification', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-15T05:00:00.000Z',
    subject, rowId: `${subject}:v1`, rowKind: 'draft', title: 'A row', readAt: null, alertedAt: null, digestOn: null, expiresAt: null, alert: null, ...fields,
  };
}
