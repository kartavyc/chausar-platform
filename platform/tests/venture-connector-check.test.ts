// Connection checks (4J7, K7): venture.connectors.check {} makes one cheap real read per connected connection (the AI
// key's free model list, the CLI's status, the bank consent, the mailbox's EXAMINE, the posting steps' last check day,
// GitHub's repo page) and answers one row each, answered, failed or skipped with its reason, never a secret. The rows
// are stored with Keeper's connection-checks run; setup health counts Ready, Warnings and Blocking, each with a fix; a
// routine can't be switched on for a connector that was never checked (ROUTINE_NEEDS_CHECK).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ConnectorChecksView, KeeperView, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { CHECK_WORDS, connectorChecked, requireConnectorChecked } from '../runtime/venture/build/connector-check.ts';
import { connectorEvidence } from '../runtime/venture/build/connector-truth.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';
import { FakeImap, MAILBOX, PUBLIC, mailCall } from './venture-mailbox-env.ts';

// Built at runtime, never shaped like a real key in the file.
const KEY = ['sk', 'ant', 'test', 'x'.repeat(24)].join('-');
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const check = (deps: VentureDeps, ctx: Context = owner) => (build as Record<string, Handler>)['venture.connectors.check'](deps, ctx, {}) as Promise<ConnectorChecksView>;
const keeper = (env: Env) => (views as Record<string, Handler>)['venture.team.keeper'](env.deps, owner, {}) as Promise<KeeperView>;

async function withKey(env: Env, presetId = 'anthropic-sonnet-5-5', routeKind = 'anthropic-messages') {
  await ventureAction(env.deps, owner, 'admin', 'seed.model', tx => {
    tx.put({
      ...tx.base('venture-model-connection'), presetId, routeKind, model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages', tiers: ['main'],
      consentDigest: 'c', consentedAt: tx.now, monthlyCapMicros: '5000000', status: 'connected',
    } as never);
  });
  env.deps.secrets.set(`model:${presetId}` as never, KEY);
}

/** The guard stubbed: every name answers a public address, and each request goes to the given answer. */
function network(env: Env, answer: (target: PinnedTarget) => { status: number; body?: string }) {
  const seen: PinnedTarget[] = [];
  env.deps.net = { ...(env.deps.net ?? {}), resolve: async () => [{ address: PUBLIC, family: 4 }], send: async target => {
    seen.push(target);
    const reply = answer(target);
    return { status: reply.status, headers: {}, body: Buffer.from(reply.body ?? '{}') };
  } };
  return seen;
}

test('with nothing connected the check answers no rows, is stored, and Keeper shows its run', async () => {
  const env = await setup();
  const before = (await keeper(env)).jobs.find(job => job.id === 'connection-checks')!;
  assert.equal(before.lastRun, null);
  const result = await check(env.deps);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.health, { ready: 0, warnings: 0, blocking: 0 });
  assert.equal(listRecords(env.store.read(), 'venture-connector-check').length, 1);
  const after = (await keeper(env)).jobs.find(job => job.id === 'connection-checks')!;
  assert.deepEqual(after.lastRun, { at: result.at, outcome: 'ok', line: CHECK_WORDS.nothing });
  assert.ok(env.published.flat().some(event => event.name === 'keeper.ran' && JSON.stringify(event.data).includes('connection-checks')));
  // A second run replaces Keeper's one record for the job.
  await check(env.deps);
  assert.equal(listRecords(env.store.read(), 'venture-keeper-run').filter(run => run.job === 'connection-checks').length, 1);
});

test("an AI key is checked with the provider's free model list; the row never carries the key", async () => {
  const env = await setup();
  await withKey(env);
  const seen = network(env, () => ({ status: 200, body: '{"data":[{"id":"claude-sonnet-5-5"}]}' }));
  const result = await check(env.deps);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url.href, 'https://api.anthropic.com/v1/models');
  assert.equal(seen[0].headers['x-api-key'], KEY);
  const [row] = result.rows;
  assert.deepEqual([row.connectorId, row.outcome, row.fix], ['model:anthropic-sonnet-5-5', 'answered', null]);
  assert.match(row.line, /free/);
  assert.deepEqual(result.health, { ready: 1, warnings: 0, blocking: 0 });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(JSON.stringify(env.store.read()).includes(KEY), false, 'no record holds the key');

  // A refused key is a failed row with its fix; Keeper's run says it failed.
  network(env, () => ({ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }));
  const refused = await check(env.deps);
  assert.equal(refused.rows[0].outcome, 'failed');
  assert.match(refused.rows[0].line, /refused/);
  assert.ok(refused.rows[0].fix);
  assert.deepEqual(refused.health, { ready: 0, warnings: 0, blocking: 1 });
  assert.equal((await keeper(env)).jobs.find(job => job.id === 'connection-checks')!.lastRun!.outcome, 'failed');
});

test('a key the app no longer holds is a failed row that says so; an OpenAI key uses its own header', async () => {
  const env = await setup();
  await withKey(env, 'openai-gpt-6-luna', 'openai-responses');
  env.deps.secrets.delete('model:openai-gpt-6-luna' as never);
  const seen = network(env, () => ({ status: 200 }));
  const missing = await check(env.deps);
  assert.equal(seen.length, 0, 'nothing is asked without the key');
  assert.equal(missing.rows[0].outcome, 'failed');
  assert.match(missing.rows[0].fix!, /again/);
  env.deps.secrets.set('model:openai-gpt-6-luna' as never, KEY);
  await check(env.deps);
  assert.equal(seen[0].url.href, 'https://api.openai.com/v1/models');
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
});

test('the bank consent reads nothing (no provider is linked): its row is skipped and says so, and proves no read', async () => {
  const env = await setup();
  const consent = (expiresAt: string) => ({ id: 'consent_1', provider: null, accountLabel: 'HDFC current', scope: 'read-only', grantedAt: '2026-10-01T00:00:00.000Z', expiresAt, revokedAt: null });
  await ventureAction(env.deps, owner, 'admin', 'seed.bank', tx => {
    tx.put({ ...tx.base('venture-bank-account'), label: 'HDFC current', currency: 'INR', consent: consent('2026-10-18T00:00:00.000Z'), polls: [] } as never);
  });
  const seen = network(env, () => ({ status: 200 }));
  const result = await check(env.deps);
  const [row] = result.rows;
  assert.deepEqual([row.connectorId, row.outcome, row.line, row.expiresOn, row.fix], ['bank-account', 'skipped', CHECK_WORDS.noBank, '2026-10-18', null]);
  assert.equal(CHECK_WORDS.noBank, 'No bank provider is linked; the consent is kept for when one is.');
  assert.deepEqual(result.health, { ready: 0, warnings: 0, blocking: 0 });
  assert.equal(seen.length, 0, 'nothing is asked of any bank');
  assert.equal(connectorEvidence(env.store.read(), env.venture.id).reads.has('bank-account'), false, 'only a statement import is a read');
  env.advance(5 * 86_400_000);
  assert.equal((await check(env.deps)).rows[0].outcome, 'skipped', 'an ended consent is still no read');
});

test('TallyPrime is read only through Sources: its row says when, and the hosted app cannot reach it', async () => {
  const env = await setup();
  // The back office's own connector read receipt (platform/runtime/connectors.ts), as a Sources read leaves it.
  await env.store.update(async draft => { ((draft as unknown as { receipts?: unknown[] }).receipts ??= []).push({ id: 'connector-read_1', at: '2026-10-14T09:00:00.000Z', connector: 'tally-prime', rows: 3 }); });
  const desktop = await check(env.deps);
  const row = desktop.rows.find(item => item.connectorId === 'tally')!;
  assert.equal(row.outcome, 'skipped');
  assert.match(row.line, /under Sources/);
  assert.match(row.line, /last read on 14 Oct 2026/);
  const hosted = await check({ ...env.deps, host: 'hosted-web' });
  const far = hosted.rows.find(item => item.connectorId === 'tally')!;
  assert.deepEqual([far.outcome, far.line], ['skipped', CHECK_WORDS.hostedTally]);
  assert.ok(far.fix);
});

test('the calendar address is read once; a lost address fails with its fix; the hosted app skips it', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'admin', 'seed.feed', tx => {
    tx.put({ ...tx.base('venture-calendar-feed'), host: 'calendar.google.com', status: 'set', lastRead: null, digest: null, line: 'x', events: [] } as never);
  });
  const missing = await check(env.deps);
  assert.deepEqual([missing.rows[0].connectorId, missing.rows[0].outcome], ['calendar', 'failed']);
  env.deps.secrets.set('network:calendar' as never, 'https://calendar.google.com/calendar/ical/me%40example.com/private-abc/basic.ics');
  const seen = network(env, () => ({ status: 200, body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }));
  const read = await check(env.deps);
  assert.deepEqual([read.rows[0].outcome, read.rows[0].account], ['answered', 'calendar.google.com']);
  assert.equal(seen[0].method, 'GET');
  assert.equal(JSON.stringify(read).includes('private-abc'), false, 'the secret address never shows');
  assert.equal(connectorEvidence(env.store.read(), env.venture.id).reads.has('google-calendar'), true);
  const hosted = await check({ ...env.deps, host: 'hosted-web' });
  assert.equal(hosted.rows[0].outcome, 'skipped');
});

test('the mailbox is checked with EXAMINE, read only, as the address it signs in as', async () => {
  const env = await setup();
  const imap = new FakeImap();
  env.deps.net = { resolve: async () => [{ address: PUBLIC, family: 4 }], tls: imap.connector };
  await mailCall(env, 'venture.mailbox.connect', MAILBOX);
  imap.commands.length = 0;
  const result = await check(env.deps);
  const row = result.rows.find(item => item.connectorId === 'mailbox')!;
  assert.equal(row.outcome, 'answered');
  assert.equal(row.account, MAILBOX.user);
  assert.match(row.line, new RegExp(`Connected as ${MAILBOX.user.replace('.', '\\.')}`));
  assert.ok(imap.commands.some(command => /^EXAMINE/i.test(command.split(' ').slice(1).join(' '))), imap.commands.join(' | '));
  assert.equal(imap.commands.some(command => /SELECT|STORE|FETCH/i.test(command)), false, 'a check reads nothing and marks nothing');
  assert.equal(JSON.stringify(result).includes(MAILBOX.appPassword), false);
  // After a restart the password is gone: failed, with the fix.
  env.deps.secrets.delete('mailbox:password' as never);
  const again = await check(env.deps);
  assert.equal(again.rows.find(item => item.connectorId === 'mailbox')!.outcome, 'failed');
});

test('GitHub through a recording, and anything on the hosted server that cannot run there, is skipped with its reason', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'admin', 'seed.github', tx => {
    tx.put({ ...tx.base('venture-build-follow'), repo: { owner: 'ledger', name: 'site' }, tokenState: 'none', linkedAt: tx.now, lastStatus: null } as never);
    tx.put({ ...tx.base('venture-mailbox'), host: 'imap.mail.example', port: 993, user: 'owner@ledger.example', status: 'connected', uidValidity: null, cursor: null, lastSync: null, line: 'x' } as never);
  });
  const hosted = await check({ ...env.deps, host: 'hosted-web' });
  const github = hosted.rows.find(row => row.connectorId === 'github')!;
  assert.equal(github.outcome, 'skipped');
  assert.equal(github.line, CHECK_WORDS.recording);
  const mailbox = hosted.rows.find(row => row.connectorId === 'mailbox')!;
  assert.equal(mailbox.outcome, 'skipped');
  assert.match(mailbox.line, /desktop/);
  // A skip that only needs the desktop is a warning with its fix; a recording needs nothing.
  assert.equal(github.fix, null);
  assert.deepEqual(hosted.health, { ready: 0, warnings: 1, blocking: 0 });
});

test('GitHub through the real API: one read of the repo page, answered or failed', async () => {
  const env = await setup();
  const paths: string[] = [];
  let status = 200;
  env.deps.github = { kind: 'github-api', async read(request) { paths.push(request.path); return { status, etag: null, body: '{"full_name":"ledger/site","private":true}', rateRemaining: 50 }; } };
  await ventureAction(env.deps, owner, 'admin', 'seed.github', tx => {
    tx.put({ ...tx.base('venture-build-follow'), repo: { owner: 'ledger', name: 'site' }, tokenState: 'none', linkedAt: tx.now, lastStatus: null } as never);
  });
  const ok = await check(env.deps);
  assert.deepEqual(paths, ['/repos/ledger/site']);
  assert.equal(ok.rows[0].outcome, 'answered');
  status = 404;
  const gone = await check(env.deps);
  assert.equal(gone.rows[0].outcome, 'failed');
  assert.ok(gone.rows[0].fix);
});

test('a routine needs a check first: ROUTINE_NEEDS_CHECK until a check has a row for that connector', async () => {
  const env = await setup();
  await withKey(env);
  assert.equal(connectorChecked(env.store.read(), env.venture.id, 'model:anthropic-sonnet-5-5'), false);
  assert.throws(() => requireConnectorChecked(env.store.read(), env.venture.id, 'model:anthropic-sonnet-5-5'), code('ROUTINE_NEEDS_CHECK'));
  network(env, () => ({ status: 200 }));
  await check(env.deps);
  requireConnectorChecked(env.store.read(), env.venture.id, 'model:anthropic-sonnet-5-5');
  assert.throws(() => requireConnectorChecked(env.store.read(), env.venture.id, 'mailbox'), code('ROUTINE_NEEDS_CHECK'));
});

test('the check needs prepare: a viewer is refused', async () => {
  const env = await setup();
  await assert.rejects(check(env.deps, { ...owner, role: 'viewer' } as Context), (error: any) => typeof error?.code === 'string');
});

test('4J21: { last: true } reads the newest check as the screens show it, with no new read and nothing stored; null before any', async () => {
  const env = await setup();
  const last = (payload: unknown, ctx: Context = owner) => (build as Record<string, Handler>)['venture.connectors.check'](env.deps, ctx, payload) as Promise<ConnectorChecksView | null>;
  assert.equal(await last({ last: true }), null);
  await withKey(env);
  const seen: unknown[] = [];
  network(env, target => { seen.push(target); return { status: 200, body: '{"data":[]}' }; });
  const ran = await check(env.deps);
  const reads = seen.length;
  const stored = listRecords(env.store.read(), 'venture-connector-check').length;
  const shown = await last({ last: true });
  assert.deepEqual(shown, { at: ran.at, rows: ran.rows, health: ran.health });
  // Reading the last check makes no request and writes no record.
  assert.equal(seen.length, reads);
  assert.equal(listRecords(env.store.read(), 'venture-connector-check').length, stored);
  // Only true is taken.
  await assert.rejects(last({ last: false }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(last({ last: true, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});
