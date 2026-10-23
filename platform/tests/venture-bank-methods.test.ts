// Bank statement import and consent as engine methods (venture.bank.import, venture.bank.consent). The statement file
// is the owner's own download: every row becomes exact minor units, a row already imported is never counted again, and
// the ledger is kept as records. Consent has an end date the owner can see; no bank provider is wired in this build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { BankConsentView, BankImportResult, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const fixture = (name: string) => readFile(new URL(`./fixtures/venture/connectors/${name}`, import.meta.url), 'utf8');
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(env: Env, method: string, payload: unknown, ctx: Context = owner) =>
  ((handlers as Record<string, Handler>)[method])(env.deps, ctx, payload) as Promise<T>;
const ACCOUNT = 'Ledger Cafe current account';

test('the bank methods are venture methods of the build package; import and consent need the app', () => {
  for (const method of ['venture.bank.import', 'venture.bank.consent'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'build');
    assert.ok(APP_ONLY_METHODS.includes(method), method);
    assert.equal(typeof (handlers as Record<string, unknown>)[method], 'function', method);
  }
});

test('venture.bank.import: an Indian statement becomes exact minor units, and the same file again adds nothing', async () => {
  const env = await setup();
  const csv = await fixture('bank-statement-in.csv');
  const first = await call<BankImportResult>(env, 'venture.bank.import', { csv, account: ACCOUNT });
  assert.equal(first.account, ACCOUNT);
  assert.match(first.accountId, /^bankaccount_/);
  assert.deepEqual([first.added, first.duplicates, first.transactions], [4, 0, 4]);
  assert.equal(first.rejected.length, 1, 'the end-of-statement line');
  assert.match(first.rejected[0].reason, /date/);
  assert.equal(first.line, 'Added 4 transactions. 1 row could not be read.');

  const again = await call<BankImportResult>(env, 'venture.bank.import', { csv, account: ACCOUNT.toUpperCase() });
  assert.equal(again.accountId, first.accountId, 'the same account, whatever the letter case');
  assert.deepEqual([again.added, again.duplicates, again.transactions], [0, 4, 4]);
  assert.match(again.line, /already here and were not counted again/);

  const state = env.store.read();
  const [account] = listRecords(state, 'venture-bank-account');
  assert.equal(listRecords(state, 'venture-bank-account').length, 1);
  assert.deepEqual([account.label, account.currency, account.consent, account.polls], [ACCOUNT, 'INR', null, []]);
  const imports = listRecords(state, 'venture-bank-import');
  assert.equal(imports.length, 2);
  // 450.00 out twice, 2,948.82 in, 2,000.00 out: -45000 - 45000 + 294882 - 200000 = 4882 minor units.
  const total = imports.flatMap(item => item.transactions).reduce((sum, t) => sum + BigInt(t.amountMinor), 0n);
  assert.equal(total, 4882n);
  assert.match(imports[0].fileDigest, /^[0-9a-f]{64}$/);
  assert.equal(imports[1].transactions.length, 0);

  // The same file is never counted in a second account (Ink v2 wave 2, 2D): it is refused in plain words.
  await assert.rejects(call(env, 'venture.bank.import', { csv, account: 'Savings' }), (error: any) => {
    assert.equal(error.code, 'BANK_STATEMENT_INVALID');
    assert.match(error.message, /already imported into Ledger Cafe current account/);
    return true;
  });
  // Another account keeps its own ledger.
  const other = await call<BankImportResult>(env, 'venture.bank.import', { csv: csv.replace('ATM WDL', 'ATM WITHDRAWAL'), account: 'Savings' });
  assert.notEqual(other.accountId, first.accountId);
  assert.equal(other.added, 4);
});

test('venture.bank.import refuses what it cannot keep honestly', async () => {
  const env = await setup();
  await assert.rejects(call(env, 'venture.bank.import', { csv: 'hello,world\n1,2\n', account: ACCOUNT }), code('BANK_STATEMENT_INVALID'));
  await assert.rejects(call(env, 'venture.bank.import', { csv: await fixture('bank-statement-in.csv'), account: '' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.bank.import', { csv: await fixture('bank-statement-in.csv'), account: ACCOUNT }, phone), code('APP_APPROVAL_REQUIRED'));
  // A statement too large for one import is refused in plain words, not cut short.
  const rows = Array.from({ length: 3000 }, (_, index) => `0${1 + (index % 9)}/10/26,PAYMENT NUMBER ${index} TO A SUPPLIER WITH A LONG NAME,,${index + 1}.00,`);
  const big = `Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.\n${rows.join('\n')}\n`;
  await assert.rejects(call(env, 'venture.bank.import', { csv: big, account: ACCOUNT }), (error: any) => {
    assert.equal(error.code, 'BANK_STATEMENT_INVALID');
    assert.match(error.message, /a month at a time/);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-bank-import').length, 0);
});

test('venture.bank.consent: read-only consent with a visible end date, no provider, and a stop the owner controls', async () => {
  const env = await setup();
  const granted = await call<BankConsentView>(env, 'venture.bank.consent', { account: ACCOUNT, days: 90 });
  assert.equal(granted.account, ACCOUNT);
  assert.equal(granted.consent.provider, null);
  assert.equal(granted.consent.scope, 'read-only');
  assert.equal(granted.consent.grantedAt, '2026-10-15T10:00:00.000Z');
  assert.equal(granted.consent.expiresAt, '2027-01-13T10:00:00.000Z');
  assert.equal(granted.status.state, 'active');
  assert.equal(granted.status.line, 'Bank access ends on 13 Jan 2027, in 90 days.');
  assert.match(granted.provider, /No bank provider is linked yet/);

  const stopped = await call<BankConsentView>(env, 'venture.bank.consent', { account: ACCOUNT, revoke: true });
  assert.equal(stopped.status.state, 'revoked');
  assert.equal(stopped.consent.revokedAt, '2026-10-15T10:00:00.000Z');
  const [account] = listRecords(env.store.read(), 'venture-bank-account');
  assert.equal(account.consent?.revokedAt, '2026-10-15T10:00:00.000Z');

  await assert.rejects(call(env, 'venture.bank.consent', { account: ACCOUNT, days: 400 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.bank.consent', { account: 'Nothing here', revoke: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.bank.consent', { account: ACCOUNT, days: 30 }, phone), code('APP_APPROVAL_REQUIRED'));
});
