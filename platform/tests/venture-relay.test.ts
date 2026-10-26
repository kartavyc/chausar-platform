// Ink v2 wave 4, package 4G3 (O13 from the desktop): the phone relay. The owner sets one https address of their own
// inside the app (an ntfy topic or similar); each alert outside the app posts {"count":N} to it and nothing else,
// through the network guard with redirects refused; url null clears it. Each post is its own action journal entry
// holding the count, the relay's host and the outcome, never the address; the one retry is a new entry. With the tray
// switched off, the desktop's notify.new carries no count, so the tray and the OS stay quiet while the relay still
// gets it. The hosted app has web push instead.
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import type { Context } from '../runtime/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import type { NotifySettingsRecord, RelayView, VentureDeps } from '../runtime/venture/contracts.ts';
import { deliveriesSettled, handlers, notifyRefresh } from '../runtime/venture/notify/index.ts';
import { DEFAULT_NOTIFY_SETTINGS } from '../runtime/venture/notify/settings.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const RELAY = 'https://ntfy.sh/chausar-ledger-7f3a';

/** The network guard's lookup and sender, answered here. 0 never answers; a 3xx asks to go elsewhere. */
function network(answers: number[] = [], address = '159.203.148.75') {
  const sent: (PinnedTarget & { text: string })[] = [];
  const looked: string[] = [];
  return {
    sent, looked,
    net: {
      resolve: async (hostname: string) => { looked.push(hostname); return [{ address, family: 4 as const }]; },
      send: async (target: PinnedTarget) => {
        sent.push({ ...target, text: Buffer.from(target.body ?? '').toString('utf8') });
        const status = answers.length ? answers.shift()! : 200;
        if (status === 0) throw Object.assign(new Error('Chausar could not reach the site. Nothing was retried.'), { code: 'NET_FAILED' });
        const headers: Record<string, string> = status >= 300 && status < 400 ? { location: 'https://elsewhere.example.com/' } : {};
        return { status, headers, body: Buffer.alloc(0) };
      },
    },
  };
}
const withNet = (env: Env, net: NonNullable<VentureDeps['net']>, host: VentureDeps['host'] = 'test'): VentureDeps => ({ ...env.deps, host, net });
const relay = (deps: VentureDeps, payload: unknown, ctx: Context = owner) =>
  (handlers['venture.notify.relay'] as (d: unknown, c: Context, p: unknown) => Promise<RelayView>)(deps, ctx, payload);
const settingsRecords = (env: Env) => listRecords(env.store.read(), 'venture-notify-settings', env.venture.id);
const entries = (env: Env) => listRecords(env.store.read(), 'venture-journal-entry', env.venture.id).filter(entry => entry.action === 'notify.relay');
/** One look by the centre, then whatever it started outside the app, to the end. */
async function look(deps: VentureDeps, ctx: Context = owner) {
  const result = await notifyRefresh(deps, ctx);
  await deliveriesSettled();
  return result;
}

test('venture.notify.relay (app only) keeps one https address the owner set, shows only its host, and null clears it', async () => {
  const env = await setup();
  const { net } = network();
  const deps = withNet(env, net);
  await assert.rejects(relay(deps, { url: RELAY }, phone), code('APP_APPROVAL_REQUIRED'));
  for (const url of ['http://ntfy.sh/x', 'https://user:secret@ntfy.sh/x', 'ftp://ntfy.sh/x', 'https://ntfy.sh/x#here', 'not an address', `https://ntfy.sh/${'a'.repeat(600)}`, 42]) {
    await assert.rejects(relay(deps, { url }), code('INVALID_VENTURE_REQUEST'), String(url));
  }
  for (const url of ['https://localhost/topic', 'https://192.168.1.4/topic', 'https://printer.local/topic']) {
    await assert.rejects(relay(deps, { url }), code('NET_ADDRESS_REFUSED'), url);
  }
  await assert.rejects(relay(deps, { url: RELAY, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(settingsRecords(env).length, 0, 'nothing was kept from a refusal');

  const set = await relay(deps, { url: RELAY });
  assert.equal(set.relay, 'ntfy.sh');
  assert.equal(set.line, 'Each alert sends ntfy.sh a count only, never names or figures.');
  assert.equal(JSON.stringify(set).includes('chausar-ledger-7f3a'), false, 'the topic is not repeated on screen');
  assert.equal(settingsRecords(env).at(-1)!.relay, RELAY);
  // The rest of the settings are carried forward untouched.
  const { relay: _relay, ...rest } = settingsRecords(env).at(-1)!;
  assert.deepEqual({ pausedUntil: rest.pausedUntil, quietHours: rest.quietHours, digest: rest.digest, push: rest.push, tray: rest.tray },
    { pausedUntil: DEFAULT_NOTIFY_SETTINGS.pausedUntil, quietHours: DEFAULT_NOTIFY_SETTINGS.quietHours, digest: DEFAULT_NOTIFY_SETTINGS.digest, push: false, tray: true });
  // An empty request reads the relay and writes nothing; the same address again writes nothing either.
  assert.deepEqual(await relay(deps, {}), set);
  await relay(deps, { url: RELAY });
  assert.equal(settingsRecords(env).length, 1);
  const cleared = await relay(deps, { url: null });
  assert.deepEqual(cleared, { relay: null, line: 'No relay is set. The tray on this computer shows the count.' });
  assert.equal(settingsRecords(env).at(-1)!.relay, null);
});

test('the hosted app has web push, so a relay there is honestly not available', async () => {
  const env = await setup();
  const { net } = network();
  await assert.rejects(relay(withNet(env, net, 'hosted-web'), { url: RELAY }, { ...owner, channel: 'web' }), (error: any) => {
    assert.equal(error.code, 'TIER_UNAVAILABLE');
    assert.match(error.message, /web push/);
    return true;
  });
});

test('an alert posts exactly {"count":3} to the relay through the network guard, and nothing else', async () => {
  const env = await setup();
  const { net, sent, looked } = network();
  const deps = withNet(env, net);
  await relay(deps, { url: RELAY });
  await seedBlueprint(env, { status: 'draft' });
  const result = await look(deps, owner);
  assert.deepEqual(result.alert, { count: 3 });
  assert.equal(sent.length, 1);
  const post = sent[0];
  assert.equal(post.method, 'POST');
  assert.equal(post.url.href, RELAY);
  assert.deepEqual(looked, ['ntfy.sh'], 'the name was looked up and every answer checked');
  assert.equal(post.address, '159.203.148.75', 'the socket goes to the checked address');
  assert.equal(post.text, '{"count":3}');
  assert.deepEqual(Object.keys(post.headers).sort(), ['content-length', 'content-type']);
  assert.equal(post.headers['content-type'], 'application/json');
  // The post is one journal entry: the count, the host and the outcome, never the address or its topic.
  assert.deepEqual(entries(env).map(entry => [entry.state, entry.target]), [['applied', 'ntfy.sh']]);
  assert.match(entries(env)[0].describe, /\(3\)/);
  assert.equal(JSON.stringify(entries(env)).includes('chausar-ledger-7f3a'), false);
  // Its digest is made from the relay's host, not its address: an exported journal cannot confirm a guessed topic.
  const [, alert, attempt] = entries(env)[0].subject.split(':');
  const newline = String.fromCharCode(10);
  assert.equal(entries(env)[0].actionDigest, createHash('sha256').update(['ntfy.sh', alert, attempt, '{"count":3}'].join(newline)).digest('hex'));
  // The same items again: nothing more is posted.
  await look(deps, owner);
  assert.equal(sent.length, 1);
});

test('the relay follows no redirect and reaches nothing inside this network; no answer or a server error is tried once more', async () => {
  const redirected = await setup();
  const away = network([302]);
  await relay(withNet(redirected, away.net), { url: RELAY });
  await seedBlueprint(redirected, { status: 'draft' });
  await look(withNet(redirected, away.net), owner);
  assert.equal(away.sent.length, 1, 'a redirect is a refusal: not followed, not tried again');
  assert.deepEqual(entries(redirected).map(entry => entry.state), ['rejected']);

  const inside = await setup();
  const rebinding = network([], '10.0.0.7');
  await relay(withNet(inside, rebinding.net), { url: RELAY });
  await seedBlueprint(inside, { status: 'draft' });
  await look(withNet(inside, rebinding.net), owner);
  assert.equal(rebinding.sent.length, 0, 'a name that answers with a private address is never sent to');
  assert.deepEqual(entries(inside).map(entry => entry.state), ['rejected'], 'known not to have gone');

  const flaky = await setup();
  const busy = network([503, 0]);
  await relay(withNet(flaky, busy.net), { url: RELAY });
  await seedBlueprint(flaky, { status: 'draft' });
  await look(withNet(flaky, busy.net), owner);
  assert.equal(busy.sent.length, 2, 'tried once more, never a third time');
  assert.ok(busy.sent.every(item => item.text === '{"count":3}'));
  assert.deepEqual(entries(flaky).map(entry => entry.state), ['rejected', 'rejected'], 'the retry is a new entry, and no answer is not an unknown to resolve');
  assert.match(entries(flaky)[1].journal.at(-1)!.line, /The next alert carries the current count\./);
});

test('with the tray off the relay still gets the count; with neither, nothing goes out', async () => {
  const env = await setup();
  const { net, sent } = network();
  const deps = withNet(env, net);
  await ventureAction(env.deps, owner, 'approve', 'seed.tray-off', tx => {
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...DEFAULT_NOTIFY_SETTINGS, tray: false });
  });
  await seedBlueprint(env, { status: 'draft' });
  assert.equal((await look(deps, owner)).alert, null);
  assert.equal(sent.length, 0);

  const other = await setup();
  const second = network();
  await ventureAction(other.deps, owner, 'approve', 'seed.tray-off', tx => {
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...DEFAULT_NOTIFY_SETTINGS, tray: false });
  });
  await relay(withNet(other, second.net), { url: RELAY });
  await seedBlueprint(other, { status: 'draft' });
  assert.deepEqual((await look(withNet(other, second.net), owner)).alert, { count: 3 });
  assert.deepEqual(second.sent.map(item => item.text), ['{"count":3}']);
  // The tray is off: notify.new says the centre changed and carries no count, so the tray and the OS stay quiet.
  const news = other.published.flat().filter(event => event.name === 'notify.new');
  assert.ok(news.length > 0 && news.every(event => !Object.hasOwn(event.data as object, 'count')));
});

test('offline with the tray off: an alert that cannot go out is tried 3 times at most, paced 10 then 30 minutes, then the settings say so', async () => {
  const env = await setup();
  const tries: number[] = [];
  // No network at all: every name lookup fails, so nothing ever leaves this computer.
  const offline: VentureDeps['net'] = {
    resolve: async () => { tries.push(Date.parse(env.now())); throw new Error('This computer is offline.'); },
    send: async () => { throw new Error('Nothing is sent while offline.'); },
  };
  const deps = withNet(env, offline!);
  await ventureAction(env.deps, owner, 'approve', 'seed.tray-off', tx => {
    tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...DEFAULT_NOTIFY_SETTINGS, tray: false });
  });
  await relay(deps, { url: RELAY });
  await seedBlueprint(env, { status: 'draft' });
  for (let minute = 0; minute < 90; minute += 1) {
    await look(deps);
    env.advance(60_000);
  }
  assert.equal(tries.length, 3, 'three tries for the same items, not one a minute');
  assert.equal(entries(env).length, 3);
  const gaps = [tries[1] - tries[0], tries[2] - tries[1]].map(ms => ms / 60_000);
  assert.ok(gaps[0] >= 10 && gaps[1] >= 30, `the pacing held across the re-waits: ${JSON.stringify(gaps)}`);
  const settings = await (handlers['venture.notify.settings'] as (d: unknown, c: Context, p: unknown) => Promise<{ line: string }>)(deps, owner, {});
  assert.match(settings.line, /Phone alerts couldn't be sent: Chausar will try with the next new item\./);

  // A new item: one more try, with everything that waits, after the pacing's wait.
  await ventureAction(env.deps, owner, 'admin', 'test.end', tx => {
    for (const record of tx.list('venture-notification')) tx.replace({ ...record, endedAt: tx.now, readAt: tx.now });
  });
  env.advance(61 * 60_000);
  await look(deps);
  assert.equal(tries.length, 4);
});
