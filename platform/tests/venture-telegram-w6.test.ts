// Wave 6 package 6F6 (D35): phone alerts through the owner's own Telegram bot. The bot token and chat id live in the
// host's protected key storage (credential name alerts:telegram), never in the business file. Each alert outside the
// app sends the bot a count only ("Chausar: 3 things wait for you."), unless the owner opted in to details, which add
// the titles of what waits. Approvals stay in the app: the message carries no link, no button and no way to approve.
// Each send is a journal entry under the owner's standing setting, holding the count and the outcome, never the token
// or chat id. The desktop app talks to the Bot API; the hosted app does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import type { Context } from '../runtime/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import type { HostCredentialPort } from '../runtime/venture/models/credential-port.ts';
import { deliveriesSettled, handlers, notifyRefresh } from '../runtime/venture/notify/index.ts';
import { TELEGRAM_CREDENTIAL } from '../runtime/venture/notify/telegram.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

// Built at runtime: no string shaped like a real bot token sits in the source.
const TOKEN = ['4815', '16234'].join('') + ':' + 'Fx'.repeat(9) + 'q'.repeat(17);
const CHAT = String(7_000_000_000 + 123_456);

function memoryCredentials(): HostCredentialPort & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return {
    saved,
    async get(workspaceId, name) { return saved.get(`${workspaceId}/${name}`) ?? null; },
    async set(workspaceId, name, value) { saved.set(`${workspaceId}/${name}`, value); },
    async delete(workspaceId, name) { saved.delete(`${workspaceId}/${name}`); },
  };
}

type Answer = { status: number; body?: unknown };
/** The network guard's lookup and sender, answered here. status 0 never answers. */
function network(answers: Answer[] = []) {
  const sent: (PinnedTarget & { text: string })[] = [];
  return {
    sent,
    net: {
      resolve: async () => [{ address: '149.154.167.220', family: 4 as const }],
      send: async (target: PinnedTarget) => {
        sent.push({ ...target, text: Buffer.from(target.body ?? '').toString('utf8') });
        const answer = answers.length ? answers.shift()! : { status: 200, body: { ok: true, result: { message_id: 1 } } };
        if (answer.status === 0) throw Object.assign(new Error('Chausar could not reach the site. Nothing was retried.'), { code: 'NET_FAILED' });
        return { status: answer.status, headers: {}, body: Buffer.from(JSON.stringify(answer.body ?? {})) };
      },
    },
  };
}

function wire(env: Env, net: NonNullable<VentureDeps['net']>, host: VentureDeps['host'] = 'desktop') {
  const credentials = memoryCredentials();
  const deps: VentureDeps = { ...env.deps, host, net, credentials };
  return { deps, credentials };
}
type View = { connected: boolean; details: boolean; line: string; said?: string };
const telegram = (deps: VentureDeps, payload: unknown, ctx: Context = owner) =>
  (handlers['venture.notify.telegram'] as (d: unknown, c: Context, p: unknown) => Promise<View>)(deps, ctx, payload);
const entries = (env: Env) => listRecords(env.store.read(), 'venture-journal-entry', env.venture.id).filter(entry => entry.target === 'api.telegram.org');
async function look(deps: VentureDeps) {
  const result = await notifyRefresh(deps, owner);
  await deliveriesSettled();
  return result;
}

test('venture.notify.telegram (app only) keeps the bot token and chat id in protected storage, never in the business file', async () => {
  const env = await setup();
  const { net, sent } = network();
  const { deps, credentials } = wire(env, net);
  await assert.rejects(telegram(deps, { bot: { token: TOKEN, chatId: CHAT } }, phone), code('APP_APPROVAL_REQUIRED'));
  for (const bot of [{ token: 'nope', chatId: CHAT }, { token: TOKEN, chatId: 'my chat' }, { token: TOKEN, chatId: CHAT, extra: 1 }, 'x']) {
    await assert.rejects(telegram(deps, { bot }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bot));
  }
  await assert.rejects(telegram(deps, { details: true }), code('TELEGRAM_NOT_SET'));
  assert.equal(credentials.saved.size, 0, 'nothing was kept from a refusal');

  const none = await telegram(deps, {});
  assert.deepEqual(none, { connected: false, details: false, line: 'No Telegram bot is set. Alerts can go to your own bot as a count only.' });

  const set = await telegram(deps, { bot: { token: TOKEN, chatId: CHAT } });
  assert.deepEqual(set, { connected: true, details: false, line: 'Alerts go to your Telegram bot as a count only, like "3 things wait for you".' });
  assert.equal(sent.length, 0, 'saving sends nothing');
  const workspace = env.store.read().workspace.id;
  assert.deepEqual(JSON.parse(credentials.saved.get(`${workspace}/${TELEGRAM_CREDENTIAL}`)!), { token: TOKEN, chatId: CHAT });
  const file = JSON.stringify(env.store.read());
  assert.equal(file.includes(TOKEN.split(':')[1]), false, 'the token is not in the business file');
  assert.equal(file.includes(CHAT), false, 'the chat id is not in the business file');

  const details = await telegram(deps, { details: true });
  assert.equal(details.details, true);
  assert.match(details.line, /titles of what waits\. Titles can name clients\./);
  assert.equal((await telegram(deps, { details: false })).details, false);

  const removed = await telegram(deps, { bot: null });
  assert.equal(removed.connected, false);
  assert.equal(credentials.saved.size, 0, 'Remove deletes the token and chat id');
});

test('the hosted app does not talk to Telegram', async () => {
  const env = await setup();
  const { net } = network();
  const { deps } = wire(env, net, 'hosted-web');
  await assert.rejects(telegram(deps, { bot: { token: TOKEN, chatId: CHAT } }, { ...owner, channel: 'web' }), (error: any) => {
    assert.equal(error.code, 'TIER_UNAVAILABLE');
    assert.match(error.message, /desktop app/);
    return true;
  });
});

test('an alert sends the bot a count only, through the network guard, with no link or button, and the journal holds no token', async () => {
  const env = await setup();
  const { net, sent } = network();
  const { deps } = wire(env, net);
  await telegram(deps, { bot: { token: TOKEN, chatId: CHAT } });
  await seedBlueprint(env, { status: 'draft' });
  const result = await look(deps);
  assert.deepEqual(result.alert, { count: 3 });
  assert.equal(sent.length, 1);
  const post = sent[0];
  assert.equal(post.method, 'POST');
  assert.equal(post.url.host, 'api.telegram.org');
  assert.equal(post.url.pathname, `/bot${TOKEN}/sendMessage`);
  assert.equal(post.address, '149.154.167.220');
  const body = JSON.parse(post.text);
  assert.deepEqual(Object.keys(body).sort(), ['chat_id', 'disable_web_page_preview', 'text']);
  assert.equal(body.chat_id, CHAT);
  assert.equal(body.text, 'Chausar: 3 things wait for you. Open the app to decide.');
  assert.equal(/https?:|reply_markup|approve/i.test(post.text), false, 'no link, no button, no way to approve from Telegram');
  assert.deepEqual(entries(env).map(entry => entry.state), ['applied']);
  const journal = JSON.stringify(entries(env));
  assert.equal(journal.includes(TOKEN.split(':')[1]), false);
  assert.equal(journal.includes(CHAT), false);
  assert.match(entries(env)[0].describe, /\(3\)/);
  // The same items again: nothing more goes out.
  await look(deps);
  assert.equal(sent.length, 1);
});

test('details are opt-in: with them on, the alert adds the titles of what waits', async () => {
  const env = await setup();
  const { net, sent } = network();
  const { deps } = wire(env, net);
  await telegram(deps, { bot: { token: TOKEN, chatId: CHAT } });
  await telegram(deps, { details: true });
  await seedBlueprint(env, { status: 'draft' });
  await look(deps);
  const text = JSON.parse(sent[0].text).text as string;
  assert.match(text, /^Chausar: 3 things wait for you\. Open the app to decide\.\n- /);
  assert.equal(text.split('\n').length, 4, 'one line per waiting item');
});

test('a Telegram refusal is not retried and shows its words; no answer or a server error is tried once more', async () => {
  const refused = await setup();
  const no = network([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
  const a = wire(refused, no.net);
  await telegram(a.deps, { bot: { token: TOKEN, chatId: CHAT } });
  await seedBlueprint(refused, { status: 'draft' });
  await look(a.deps);
  assert.equal(no.sent.length, 1);
  assert.deepEqual(entries(refused).map(entry => entry.state), ['rejected']);
  assert.match(entries(refused)[0].journal.at(-1)!.line, /chat not found/);

  const flaky = await setup();
  const busy = network([{ status: 502 }, { status: 0 }]);
  const b = wire(flaky, busy.net);
  await telegram(b.deps, { bot: { token: TOKEN, chatId: CHAT } });
  await seedBlueprint(flaky, { status: 'draft' });
  await look(b.deps);
  assert.equal(busy.sent.length, 2, 'tried once more, never a third time');
  assert.deepEqual(entries(flaky).map(entry => entry.state), ['rejected', 'rejected']);
});

test('a test alert sends the current count only, even with details on', async () => {
  const env = await setup();
  const { net, sent } = network();
  const { deps } = wire(env, net);
  await assert.rejects(telegram(deps, { test: true }), code('TELEGRAM_NOT_SET'));
  await telegram(deps, { bot: { token: TOKEN, chatId: CHAT } });
  await telegram(deps, { details: true });
  const said = await telegram(deps, { test: true });
  assert.equal(said.said, 'Telegram took the test alert.');
  assert.equal(JSON.parse(sent[0].text).text, 'Chausar: 0 things wait for you. Open the app to decide.');
});

test('the desktop key contract accepts the Telegram credential name', async () => {
  const { validate } = await import('../runtime/venture/models/credential-contract.cjs');
  assert.doesNotThrow(() => validate('workspace_1', TELEGRAM_CREDENTIAL, JSON.stringify({ token: TOKEN, chatId: CHAT }), true));
});

// C5 task 11: Find me reads the bot's own updates once (getUpdates, through the network guard and the stand-in
// sender), picks the newest private chat that sent /start, and answers its first name and chat id; nothing is stored
// until the owner saves through venture.notify.telegram. A group is skipped; a webhook (409) and no /start yet answer
// plain words. The token never reaches a record.
type Found = { found: { chatId: string; name: string } | null; line: string };
const findChat = (deps: VentureDeps, payload: unknown, ctx: Context = owner) =>
  (handlers['venture.notify.telegram.findChat'] as (d: unknown, c: Context, p: unknown) => Promise<Found>)(deps, ctx, payload);
const update = (id: number, chat: Record<string, unknown>, text: string) => ({ update_id: id, message: { message_id: id, date: 1, chat, text } });

test('Find me: the newest private chat that sent /start gives its id and first name; a group is skipped; nothing is stored', async () => {
  const env = await setup();
  const { sent, net } = network([{ status: 200, body: { ok: true, result: [
    update(1, { id: 111, type: 'private', first_name: 'Old' }, '/start'),
    update(2, { id: Number(CHAT), type: 'private', first_name: 'Kartavy' }, '/start'),
    update(3, { id: -555, type: 'group', title: 'Team' }, '/start'),
    update(4, { id: 222, type: 'private', first_name: 'Hello' }, 'hello'),
  ] } }]);
  const { deps, credentials } = wire(env, net);
  const before = env.store.read().revision;
  const result = await findChat(deps, { token: TOKEN });
  assert.deepEqual(result.found, { chatId: CHAT, name: 'Kartavy' });
  assert.equal(result.line, 'Is this you: Kartavy?');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.method, 'GET');
  assert.match(sent[0]!.url.pathname, /\/getUpdates$/);
  assert.equal(env.store.read().revision, before, 'nothing is written');
  assert.equal(credentials.saved.size, 0, 'nothing is saved until the owner says yes');
  assert.ok(!JSON.stringify(env.store.read()).includes(TOKEN));
  await assert.rejects(findChat(deps, { token: TOKEN }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(findChat(deps, { token: 'nope' }), code('INVALID_VENTURE_REQUEST'));
});

test('Find me: no /start yet and a webhook each answer plain words', async () => {
  const env = await setup();
  const empty = wire(env, network([{ status: 200, body: { ok: true, result: [update(1, { id: -1, type: 'group', title: 'Team' }, '/start')] } }]).net);
  assert.deepEqual(await findChat(empty.deps, { token: TOKEN }), { found: null, line: 'Send /start to your bot in Telegram, then press Find me again.' });
  const hooked = wire(env, network([{ status: 409, body: { ok: false, description: 'Conflict: can\'t use getUpdates method while webhook is active' } }]).net);
  const said = await findChat(hooked.deps, { token: TOKEN });
  assert.equal(said.found, null);
  assert.match(said.line, /webhook/);
  assert.ok(!said.line.includes(TOKEN));
  const refused = wire(env, network([{ status: 401, body: { ok: false } }]).net);
  assert.match((await findChat(refused.deps, { token: TOKEN })).line, /refused the bot token/);
});
