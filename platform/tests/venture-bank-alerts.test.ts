// Ink v2 wave 2, package 2D: bank alerts. The owner sets the rules and where alerts go, inside the app only; the address
// passes the network guard and is never shown back. After a statement import, code checks the rules on the new rows,
// Today gets one bank alert row, and one journalled bank.alert sends the count of alerts and nothing else (spec 5.7):
// no amount, no description, no transaction id. The send goes through the network guard's fetch with redirects
// refused; the lookup and the sender are test stubs, so nothing leaves this computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import type { BankAlertsView, BankImportResult, JournalRecord, QueueList, VentureDeps } from '../runtime/venture/contracts.ts';
import type { PinnedAnswer, PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const TABLES = [buildHandlers, viewHandlers] as Record<string, Handler | undefined>[];
function run<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = TABLES.map(table => table[method]).find(Boolean);
  assert.ok(handler, `no handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

// Built at run time, so no fixture holds a string shaped like a real webhook.
const HOOK = ['https://hooks', 'example', 'com/chausar-alerts'].join('.');
const HOOK_HOST = 'hooks.example.com';
const ACCOUNT = 'HDFC current';
const STATEMENT = 'Date,Description,Amount,Counterparty\n2026-10-04,RENT TO MR SHARMA,-60000.00,R Sharma\n2026-10-05,UPI CAFE,-450.00,\n';

type Sent = PinnedTarget[];
/** A public lookup and a sender that records each request and answers with the given status. */
function wire(env: Env, answer: (target: PinnedTarget) => PinnedAnswer | Promise<PinnedAnswer> = () => ({ status: 204, headers: {}, body: Buffer.alloc(0) })): Sent {
  const sent: Sent = [];
  env.deps.net = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    send: async target => { sent.push(target); return answer(target); },
  };
  return sent;
}
const alertEntries = (env: Env) => listRecords(env.store.read(), 'venture-journal-entry').filter((entry: JournalRecord) => entry.action === 'bank.alert');
const bankRows = async (env: Env, ctx: Context = owner) => (await run<QueueList>(env, 'venture.queue.list', {}, ctx)).rows.filter(row => row.kind === 'bank');

test('venture.bank.alerts.set keeps the rules and the address the owner set; get shows the rules and never the address', async () => {
  const env = await setup();
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [], alertAddress: HOOK }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [], alertAddress: 'http://hooks.example.com/x' }), code('INVALID_VENTURE_REQUEST'));
  // The network guard (W1 H16): never an address inside this computer or its network, in any spelling.
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [], alertAddress: 'https://10.0.0.7/hook' }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [], alertAddress: 'https://0x7f000001/hook' }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit' }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '-5' }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'wire-money', minor: '5' }] }), code('INVALID_VENTURE_REQUEST'));

  // The owner types 50,000.00 in rupees; the engine keeps 5000000 minor units. Minor text works too.
  const set = await run<BankAlertsView>(env, 'venture.bank.alerts.set', {
    account: ACCOUNT, alertAddress: HOOK,
    rules: [{ kind: 'large-debit', amount: '50,000.00' }, { kind: 'balance-below', minor: '1000000' }, { kind: 'credit-matching', text: 'INV-0007' }],
  });
  assert.equal(set.accounts.length, 1);
  const [account] = set.accounts;
  assert.equal(account.account, ACCOUNT);
  assert.deepEqual(account.rules, [{ kind: 'large-debit', minor: '5000000' }, { kind: 'balance-below', minor: '1000000' }, { kind: 'credit-matching', text: 'INV-0007' }]);
  assert.deepEqual(account.ruleLines, [
    'When INR 50,000.00 or more goes out in one payment.',
    'When the balance falls below INR 10,000.00.',
    'When money comes in that mentions INV-0007.',
  ]);
  assert.match(account.destination, /^Alerts go to the address you set/);
  const [stored] = listRecords(env.store.read(), 'venture-bank-account');
  assert.equal(stored.alertAddress?.url, HOOK);
  assert.equal(stored.alertAddress?.setBy, 'owner');

  const got = await run<BankAlertsView>(env, 'venture.bank.alerts.get', {}, phone);
  assert.deepEqual(got, set);
  assert.ok(!JSON.stringify(got).includes(HOOK_HOST), 'the address itself never comes back');

  // Leaving the address out keeps it; null clears it.
  await run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }] });
  assert.equal(listRecords(env.store.read(), 'venture-bank-account')[0].alertAddress?.url, HOOK);
  const cleared = await run<BankAlertsView>(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }], alertAddress: null });
  assert.match(cleared.accounts[0].destination, /^Alerts show on Today only/);
  assert.equal(listRecords(env.store.read(), 'venture-bank-account')[0].alertAddress, null);
});

test('after an import, the rules find a 60,000.00 debit: one Today row and one journalled send of the count only', async () => {
  const env = await setup();
  const sent = wire(env);
  await run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }], alertAddress: HOOK });
  const imported = await run<BankImportResult>(env, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
  assert.match(imported.line, /1 bank alert/);

  // One request, to the address the owner set, through the guard: POST, the count and nothing else.
  assert.equal(sent.length, 1);
  const [request] = sent;
  assert.equal(request.method, 'POST');
  assert.equal(request.url.href, HOOK);
  assert.equal(request.address, '93.184.216.34');
  assert.deepEqual(JSON.parse(String(request.body)), { count: 1 });
  for (const secret of ['60000', '60,000', 'SHARMA', 'Sharma', 'RENT', 'fp_', 'ref_']) assert.ok(!String(request.body).includes(secret), secret);

  const entries = alertEntries(env);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, 'applied');
  assert.equal(entries[0].descriptionComplete, true);
  assert.ok(!JSON.stringify(entries[0]).includes(HOOK_HOST), 'the journal keeps no address');
  assert.ok(!JSON.stringify(entries[0]).includes('60,000'), 'the journal keeps no amount');

  // Today, in the app: one bank alert row with what tripped.
  const [row] = await bankRows(env);
  assert.equal(row.title, '1 bank alert from your statement');
  assert.match(row.line ?? '', /A large payment went out/);
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['later', 'Later', false], ['approve', 'Seen', true]]);
  // On the phone, the same row carries the count only.
  const [onPhone] = await bankRows(env, phone);
  assert.equal(onPhone.title, '1 bank alert from your statement');
  assert.equal(onPhone.line, undefined);
  for (const secret of ['60,000', 'RENT', 'Sharma', ACCOUNT]) assert.ok(!JSON.stringify(onPhone).includes(secret), secret);

  // The same file again adds nothing, so nothing new alerts and nothing is sent.
  await run(env, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
  assert.equal(sent.length, 1);
  assert.equal(alertEntries(env).length, 1);
  assert.equal((await bankRows(env)).length, 1);

  // Seen takes the row off Today.
  const decided = await run<{ outcome: string }>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done');
  assert.equal((await bankRows(env)).length, 0);
});

test('with no address set, the alert waits on Today and nothing is sent', async () => {
  const env = await setup();
  const sent = wire(env);
  await run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }] });
  await run(env, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
  assert.equal(sent.length, 0);
  assert.equal(alertEntries(env).length, 0);
  assert.equal((await bankRows(env)).length, 1);
});

test('what the alert address answered: 2xx sent, 4xx and a redirect refused it, 5xx unknown; each sent once, the import stands', async () => {
  const cases: { status: number; headers?: Record<string, string>; state: string; journal: RegExp; line: RegExp }[] = [
    { status: 204, state: 'applied', journal: /^Sent the alert count \(1\) to your alert address\.$/, line: /The count went to your alert address\.$/ },
    { status: 403, state: 'rejected', journal: /^Your alert address refused it \(403\)\.$/, line: /Your alert address refused it\. See the journal\.$/ },
    { status: 302, headers: { location: 'https://elsewhere.example.com/' }, state: 'rejected', journal: /^Your alert address refused it: it asked Chausar to send it somewhere else/, line: /Your alert address refused it\. See the journal\.$/ },
    { status: 503, state: 'outcome_unknown', journal: /^Your alert address answered with an error \(503\)\./, line: /may or may not have reached your alert address/ },
  ];
  for (const item of cases) {
    const env = await setup();
    const sent = wire(env, () => ({ status: item.status, headers: item.headers ?? {}, body: Buffer.alloc(0) }));
    await run(env, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }], alertAddress: HOOK });
    const imported = await run<BankImportResult>(env, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
    assert.equal(imported.added, 2, `${item.status}`);
    assert.equal(sent.length, 1, `${item.status}: one request, never a second`);
    const [entry] = alertEntries(env);
    assert.equal(entry.state, item.state, `${item.status}`);
    assert.match(entry.journal[entry.journal.length - 1].line, item.journal);
    assert.match(imported.line, item.line);
  }

  // Refused before anything left this computer: not sent, in those words.
  const inside = await setup();
  // The name now looks up to an address inside the network: the guard refuses it before the sender is ever called.
  inside.deps.net = { resolve: async () => [{ address: '10.0.0.9', family: 4 }], send: async () => { throw new Error('never sent'); } };
  await run(inside, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }], alertAddress: HOOK });
  const refused = await run<BankImportResult>(inside, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
  assert.equal(alertEntries(inside)[0].state, 'rejected');
  assert.match(refused.line, /The count was not sent to your alert address\. See the journal\.$/);

  const slow = await setup();
  wire(slow, () => { throw new ChausarError('NET_TIMEOUT', 'The site did not answer in time.'); });
  await run(slow, 'venture.bank.alerts.set', { account: ACCOUNT, rules: [{ kind: 'large-debit', minor: '5000000' }], alertAddress: HOOK });
  const timed = await run<BankImportResult>(slow, 'venture.bank.import', { csv: STATEMENT, account: ACCOUNT });
  assert.equal(timed.added, 2);
  assert.equal(alertEntries(slow)[0].state, 'outcome_unknown');
  assert.equal((await bankRows(slow)).length, 1, 'the alert is on Today whatever happened to the send');
});

test('rules that look at the balance and at money that never came: once each, on the import that shows it', async () => {
  const env = await setup();
  wire(env);
  await run(env, 'venture.bank.alerts.set', {
    account: ACCOUNT, alertAddress: HOOK,
    rules: [{ kind: 'balance-below', minor: '1000000' }, { kind: 'credit-missing-by', text: 'INV-0009', minor: '500000', by: '2026-10-10' }],
  });
  // The clock is 15 Oct 2026: INV-0009's money was due by 10 Oct and never came. The closing balance is 5,000.00.
  const csv = 'Date,Description,Amount,Closing Balance\n2026-10-12,UPI CAFE,-450.00,5000.00\n';
  await run(env, 'venture.bank.import', { csv, account: ACCOUNT });
  const [row] = await bankRows(env);
  assert.equal(row.title, '2 bank alerts from your statement');
  assert.deepEqual(alertEntries(env).map(entry => entry.state), ['applied']);
  // A later import that is still below and still missing: the balance alerts again, the missing money does not.
  env.advance(1000);
  await run(env, 'venture.bank.import', { csv: 'Date,Description,Amount,Closing Balance\n2026-10-13,UPI TEA,-50.00,4950.00\n', account: ACCOUNT });
  const titles = (await bankRows(env)).map(item => item.title);
  assert.deepEqual(titles, ['2 bank alerts from your statement', '1 bank alert from your statement']);
});
