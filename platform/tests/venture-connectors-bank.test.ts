// P2-connectors: the read-only bank connector shape. No provider is wired, so the card says planned, but the statement
// import, the transaction fingerprints that stop a re-import counting twice, the consent with its visible end date, the
// polling cap and the alert destination the model cannot change are real code, tested here on synthetic statements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/index.ts';
import { connectorCard } from '../runtime/venture/build/connectors.ts';
import {
  BANK_POLLS_PER_DAY, alertDeliveries, consentStatus, emptyLedger, evaluateAlerts, grantConsent, importStatement, modelBankView, parseStatementCsv,
  pollAllowed, recordPoll, requireActiveConsent, revokeConsent, setAlertWebhook, type BankSettings,
} from '../runtime/venture/build/bank.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };
const fixture = (name: string) => readFile(new URL(`./fixtures/venture/connectors/${name}`, import.meta.url), 'utf8');
const INR = { currency: 'INR', minorDigits: 2, dateOrder: 'day-month-year' as const };
const USD = { currency: 'USD', minorDigits: 2, dateOrder: 'month-day-year' as const };
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n).toString();

test('the bank card reads statement files you import; a live bank link is planned, with no provider, and it never claims to sync', () => {
  const card = connectorCard(CONNECTOR_CATALOGUE.find(item => item.id === 'bank-account')!, false);
  assert.deepEqual(card.modes.map(m => [m.mode, m.status]), [['read', 'available']]);
  assert.match(card.modes[0].what, /statement file you download/);
  assert.match(card.modes[0].what, /read only/);
  assert.match(card.modes[0].what, /end date/);
  assert.match(card.modes[0].what, /is planned: no provider is linked yet/);
  assert.match(card.note, /never moves money/);
  assert.deepEqual(card.postingOptions, []);
  assert.equal(card.posting, undefined);
});

test('an Indian statement: debit and credit columns, lakh commas, two-digit years and empty references become exact minor units', async () => {
  const parsed = parseStatementCsv(await fixture('bank-statement-in.csv'), INR);
  assert.equal(parsed.rows.length, 4);
  assert.deepEqual(parsed.rows.map(r => r.date), ['2026-10-01', '2026-10-01', '2026-10-03', '2026-10-05']);
  assert.deepEqual(parsed.rows.map(r => r.amountMinor), ['-45000', '-45000', '294882', '-200000']);
  assert.deepEqual(parsed.rows.map(r => r.balanceAfterMinor), ['10455000', '10410000', '10704882', '10504882']);
  assert.deepEqual(parsed.rows.map(r => r.reference), [null, null, 'N276260001234', '000000123456']);
  assert.equal(parsed.rows[2].description, 'NEFT CR-LEDGER CAFE BOOKS-INV-0001');
  assert.equal(parsed.rejected.length, 1, 'the end-of-statement line');
  assert.match(parsed.rejected[0].reason, /date/);
});

test('fingerprints: the bank reference when there is one, a hash otherwise, and a counter for identical twins', async () => {
  const first = importStatement(emptyLedger('Lumen Studio current account', 'USD'), await fixture('bank-statement-us-1.csv'), USD);
  assert.equal(first.added.length, 4);
  assert.equal(first.duplicates, 0);
  const [coffee, twin, payment] = first.added;
  assert.match(coffee.id, /^fp_[0-9a-f]{16}$/);
  assert.equal(twin.id, `${coffee.id}#2`, 'same day, same amount, same shop: kept apart');
  assert.match(payment.id, /^ref_[0-9a-f]{16}$/);
  assert.equal(first.rejected.length, 1);
  assert.equal(first.added[3].description, 'Office rent, October');
  assert.equal(sum(first.ledger.transactions.map(t => t.amountMinor)), '-68900');

  // The same statement again: nothing is counted twice.
  const again = importStatement(first.ledger, await fixture('bank-statement-us-1.csv'), USD);
  assert.equal(again.added.length, 0);
  assert.equal(again.duplicates, 4);
  assert.equal(again.ledger.transactions.length, 4);
  assert.match(again.line, /not counted again/);

  // An overlapping, longer statement adds only what is new; a row with more cents than the currency has is refused, not rounded.
  const next = importStatement(again.ledger, await fixture('bank-statement-us-2.csv'), USD);
  assert.deepEqual(next.added.map(t => [t.description, t.amountMinor]), [['Refund "late" fee', '1525']]);
  assert.equal(next.duplicates, 4);
  assert.equal(next.rejected.length, 1);
  assert.match(next.rejected[0].reason, /more decimal places/);
  assert.equal(next.ledger.transactions.length, 5);
  assert.equal(sum(next.ledger.transactions.map(t => t.amountMinor)), '-67375');
  assert.equal(new Set(next.ledger.transactions.map(t => t.id)).size, 5);
});

test('a file without a statement header is refused; a currency mismatch is refused', async () => {
  assert.throws(() => parseStatementCsv('hello,world\n1,2\n', USD), code('BANK_STATEMENT_INVALID'));
  const csv = await fixture('bank-statement-us-1.csv');
  assert.throws(() => importStatement(emptyLedger('Card', 'INR'), csv, USD), code('BANK_STATEMENT_INVALID'));
});

test('consent: read only, an end date the owner can see, a warning a week before, and nothing read after it ends', () => {
  const consent = grantConsent({ id: 'consent_1', provider: null, accountLabel: 'Lumen Studio current account', grantedAt: '2026-10-21T10:00:00.000Z', days: 90 });
  assert.equal(consent.scope, 'read-only');
  assert.equal(consent.expiresAt, '2027-01-19T10:00:00.000Z');
  const now = consentStatus(consent, new Date('2026-10-21T10:00:00.000Z'), 'day-month-year');
  assert.deepEqual(now, { state: 'active', daysLeft: 90, line: 'Bank access ends on 19 Jan 2027, in 90 days.' });
  const soon = consentStatus(consent, new Date('2027-01-14T10:00:00.000Z'), 'day-month-year');
  assert.equal(soon.state, 'expiring');
  assert.equal(soon.line, 'Bank access ends on 19 Jan 2027, in 5 days. Renew it before then.');
  const ended = consentStatus(consent, new Date('2027-01-20T10:00:00.000Z'), 'day-month-year');
  assert.equal(ended.state, 'expired');
  assert.throws(() => requireActiveConsent(consent, new Date('2027-01-20T10:00:00.000Z')), code('BANK_CONSENT_EXPIRED'));
  assert.doesNotThrow(() => requireActiveConsent(consent, new Date('2026-12-01T00:00:00.000Z')));
  const revoked = revokeConsent(consent, '2026-10-22T08:00:00.000Z');
  assert.equal(consentStatus(revoked, new Date('2026-10-23T00:00:00.000Z'), 'day-month-year').line, 'You stopped bank access on 22 Oct 2026.');
  assert.throws(() => requireActiveConsent(revoked, new Date('2026-10-23T00:00:00.000Z')), code('BANK_CONSENT_EXPIRED'));
  assert.throws(() => grantConsent({ id: 'c', provider: null, accountLabel: 'x', grantedAt: '2026-10-21T10:00:00.000Z', days: 400 }), code('INVALID_VENTURE_REQUEST'));
});

test('polling cap: four unattended reads in any 24 hours, then a refusal that says when the next one may run', () => {
  assert.equal(BANK_POLLS_PER_DAY, 4);
  let polls: string[] = [];
  for (const hour of ['00', '06', '12', '18']) polls = recordPoll(polls, new Date(`2026-10-21T${hour}:00:00.000Z`));
  const blocked = pollAllowed(polls, new Date('2026-10-21T23:00:00.000Z'));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nextAt, '2026-10-22T00:00:00.000Z');
  assert.throws(() => recordPoll(polls, new Date('2026-10-21T23:00:00.000Z')), code('BANK_POLL_LIMIT'));
  const later = recordPoll(polls, new Date('2026-10-22T00:00:01.000Z'));
  assert.equal(later.length, 4, 'polls older than a day drop off');
});

test('alerts: checked by code with BigInt, sent only to the address the owner set in the app, which the model never sees or changes', async () => {
  const ledger = importStatement(emptyLedger('Card', 'USD'), await fixture('bank-statement-us-2.csv'), USD).ledger;
  const rules = [
    { kind: 'balance-below' as const, minor: '50000' },
    { kind: 'large-debit' as const, minor: '50000' },
    { kind: 'credit-matching' as const, text: 'INV-0002' },
    { kind: 'credit-missing-by' as const, text: 'INV-0003', minor: '12000', by: '2026-10-10' },
  ];
  const alerts = evaluateAlerts(rules, ledger, { today: '2026-10-11', balanceMinor: '40000' });
  assert.deepEqual(alerts.map(a => a.rule.kind), ['balance-below', 'large-debit', 'credit-matching', 'credit-missing-by']);
  assert.ok(evaluateAlerts(rules.slice(3), ledger, { today: '2026-10-09', balanceMinor: '90000' }).length === 0, 'not due yet');

  let settings: BankSettings = { consent: null, polls: [], rules, alertWebhook: null };
  assert.deepEqual(alertDeliveries(settings, alerts), [], 'no address set: nothing is sent');
  const modelCtx: Context = { ...owner, channel: 'mcp' };
  assert.throws(() => setAlertWebhook(settings, 'https://hooks.example.test/a', modelCtx, '2026-10-21T10:00:00.000Z'), code('APP_APPROVAL_REQUIRED'));
  assert.throws(() => setAlertWebhook(settings, 'https://hooks.example.test/a', { ...owner, sourceTainted: true }, '2026-10-21T10:00:00.000Z'), code('APP_APPROVAL_REQUIRED'));
  assert.throws(() => setAlertWebhook(settings, 'http://hooks.example.test/a', owner, '2026-10-21T10:00:00.000Z'), code('INVALID_VENTURE_REQUEST'));
  settings = setAlertWebhook(settings, 'https://hooks.example.test/a', owner, '2026-10-21T10:00:00.000Z');
  const deliveries = alertDeliveries(settings, alerts);
  assert.equal(deliveries.length, 4);
  assert.ok(deliveries.every(d => d.url === 'https://hooks.example.test/a'));
  const view = modelBankView(settings);
  assert.ok(!JSON.stringify(view).includes('hooks.example.test'), 'the model view hides the address');
  assert.equal(view.alertsGoTo, 'the address you set in the app');
});

test('static: bank.ts does no float arithmetic on money, throws only declared codes and keeps the house style', async () => {
  const source = await readFile(new URL('../runtime/venture/build/bank.ts', import.meta.url), 'utf8');
  for (const banned of ['parseFloat', 'toFixed', 'Math.round', 'Number(']) assert.ok(!source.includes(banned), banned);
  for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), match[1]);
  assert.ok(!source.includes('—'));
  assert.deepEqual(houseStyleFindings(source), []);
});
