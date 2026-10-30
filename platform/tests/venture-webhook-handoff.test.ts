// Package 5A6 (Ink v2 wave 5, catalogue K24): the webhook handoff for owners who already run n8n or Make. Setting the
// address is standing configuration: approve, inside the app, through the network guard; the address is a key in
// itself, so it lives on the secret shelf only, never in a record or an event. Sending an item is an always-ask
// journalled action whose line shows the exact payload; a 2xx answer is applied, a 4xx is known not to have arrived,
// and a timeout or a server error is outcome unknown (1B), never sent again on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { JournalRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { ChausarError } from '../runtime/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { sendToWebhook, TEST_ITEM, webhookPayloadText } from '../runtime/venture/build/webhook-handoff.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
// Built at runtime: a webhook address is a key in itself, so no test file holds one whole.
const HOOK = ['https://flows.example', 'webhook', ['a1b2', 'c3d4'].join('-')].join('/');

function wire(env: Env, answer: (target: PinnedTarget) => Promise<{ status: number; body?: string }>) {
  const sent: PinnedTarget[] = [];
  env.deps.net = {
    resolve: async host => [{ address: host === 'lan.example' ? '192.168.0.9' : PUBLIC, family: 4 }],
    send: async target => {
      sent.push(target);
      const out = await answer(target);
      return { status: out.status, headers: { 'content-type': 'application/json' }, body: Buffer.from(out.body ?? '{}') };
    },
  };
  return sent;
}
const set = (env: Env, payload: Record<string, unknown>, ctx: Context = owner) =>
  (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>)['venture.webhook.set'](env.deps, ctx, payload);
const entries = (env: Env): JournalRecord[] => listRecords(env.store.read(), 'venture-journal-entry');

test('setting the address: app only, through the guard, kept on the shelf only, and the view gives its host alone', async () => {
  const env = await setup();
  wire(env, async () => ({ status: 200 }));
  await assert.rejects(set(env, { kind: 'n8n', url: HOOK }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(set(env, { kind: 'n8n', url: 'http://127.0.0.1:5678/webhook/x' }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(set(env, { kind: 'make', url: 'https://lan.example/hook' }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(set(env, { kind: 'zapier', url: HOOK }), code('INVALID_VENTURE_REQUEST'));
  const view = await set(env, { kind: 'n8n', url: HOOK });
  assert.deepEqual(view, { kind: 'n8n', set: true, host: 'flows.example', line: view.line, test: null });
  assert.doesNotMatch(JSON.stringify(view), /a1b2/);
  assert.equal(env.deps.secrets.get('webhook:n8n'), HOOK);
  assert.ok(!JSON.stringify(env.store.read()).includes('a1b2-c3d4'), 'the address is in no record');
  assert.ok(!JSON.stringify(env.published).includes('a1b2-c3d4'), 'or event');
  const cleared = await set(env, { kind: 'n8n', url: null });
  assert.equal(cleared.set, false);
  assert.equal(env.deps.secrets.get('webhook:n8n'), null);
});

test('the test item: shown first, sent once as a journalled write, 2xx keeps the address', async () => {
  const env = await setup();
  const sent = wire(env, async () => ({ status: 200 }));
  const view = await set(env, { kind: 'make', url: HOOK, test: true });
  assert.equal(view.test, 'answered');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'POST');
  assert.equal(String(sent[0].body), webhookPayloadText(TEST_ITEM));
  assert.equal(sent[0].headers['content-type'], 'application/json');
  const [entry] = entries(env);
  assert.equal(entry.action, 'connector.write');
  assert.equal(entry.operation, 'webhook-send');
  assert.equal(entry.state, 'applied');
  assert.ok(entry.describe.includes(webhookPayloadText(TEST_ITEM)), 'the line shows the exact payload');
  assert.ok(!entry.target.includes('a1b2'), 'the journal names the host only');
});

test('a 4xx is known not to have arrived; a timeout or a server error is outcome unknown and never sent again', async () => {
  const env = await setup();
  let status = 404;
  const sent = wire(env, async () => {
    if (status === 0) throw new ChausarError('NET_TIMEOUT', 'The site did not answer in time. Chausar did not retry it.');
    return { status };
  });
  await assert.rejects(set(env, { kind: 'n8n', url: HOOK, test: true }), code('WEBHOOK_REFUSED'));
  assert.equal(env.deps.secrets.get('webhook:n8n'), null, 'an address that refused the test is not kept');
  assert.equal(entries(env)[0].state, 'rejected');

  status = 200;
  await set(env, { kind: 'n8n', url: HOOK });
  const item = { order: 'ord_1', text: 'Your September books are ready.' };
  await assert.rejects(sendToWebhook(env.deps, phone, { kind: 'n8n', subject: 'run_1', payload: item }), code('APP_APPROVAL_REQUIRED'));
  status = 0;
  const done = await sendToWebhook(env.deps, owner, { kind: 'n8n', subject: 'run_1', payload: item });
  assert.equal(done.entry.state, 'outcome_unknown');
  assert.match(done.entry.journal.at(-1)!.line, /Check before retrying/);
  const before = sent.length;
  status = 200;
  await assert.rejects(sendToWebhook(env.deps, owner, { kind: 'n8n', subject: 'run_1', payload: item }), code('JOURNAL_OUTCOME_UNKNOWN'));
  assert.equal(sent.length, before, 'never sent again on its own');
  status = 502;
  const unknown = await sendToWebhook(env.deps, owner, { kind: 'n8n', subject: 'run_2', payload: item });
  assert.equal(unknown.entry.state, 'outcome_unknown', 'a server error may have run part of the workflow');
  status = 200;
  const applied = await sendToWebhook(env.deps, owner, { kind: 'n8n', subject: 'run_3', payload: item });
  assert.equal(applied.entry.state, 'applied');
  assert.equal(String(sent.at(-1)!.body), webhookPayloadText(item));
  // No address set: nothing is proposed.
  await set(env, { kind: 'make', url: null });
  await assert.rejects(sendToWebhook(env.deps, owner, { kind: 'make', subject: 'run_4', payload: item }), code('WEBHOOK_NOT_SET'));
});

test('any error once the request went out is outcome unknown; only refusals before sending are known not to have gone', async () => {
  const env = await setup();
  let failWith: string | null = null;
  const sent = wire(env, async () => {
    if (failWith) throw new ChausarError(failWith, 'The site sent back more than Chausar reads.');
    return { status: 200 };
  });
  await set(env, { kind: 'n8n', url: HOOK });
  const item = { order: 'ord_9', text: 'Ready.' };
  for (const [index, codeName] of ['NET_RESPONSE_TOO_LARGE', 'NET_REDIRECT_REFUSED', 'NET_TOO_MANY_REDIRECTS', 'NET_FAILED', 'SOMETHING_ELSE'].entries()) {
    failWith = codeName;
    const done = await sendToWebhook(env.deps, owner, { kind: 'n8n', subject: `after_${index}`, payload: item });
    assert.equal(done.entry.state, 'outcome_unknown', codeName);
  }
  // Refused before anything left: the lookup failed.
  failWith = null;
  const before = sent.length;
  env.deps.net = { ...env.deps.net, resolve: async () => { throw new ChausarError('NET_LOOKUP_FAILED', 'Chausar could not find this address.'); } };
  const lookup = await sendToWebhook(env.deps, owner, { kind: 'n8n', subject: 'lookup', payload: item });
  assert.equal(lookup.entry.state, 'rejected');
  assert.equal(sent.length, before, 'nothing was sent');
});
