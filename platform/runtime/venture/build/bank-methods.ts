// Chausar venture launcher: the bank shape as engine methods. venture.bank.import { csv, account } and
// venture.bank.consent { account, days?, revoke? }, both the owner's own clicks inside the app.
// The statement file is one the owner downloaded from their bank: bank.ts reads it into exact minor units and gives each
// transaction a stable id, so a row already imported is never counted again, across imports too. Each import is its
// own record holding only the rows it added. Consent is read-only access with an end date; no bank provider is wired,
// so nothing reads the bank on its own yet and the consent says so.
import { createHash } from 'node:crypto';
import { check, type Context } from '../../contracts.ts';
import type {
  BankAccountRecord, BankConsentView, BankImportRecord, BankImportResult, BankTransactionData, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, MAX_STORED_PAYLOAD, requireAppChannel, singleLine, smallInteger, ventureAction, type VentureTx } from '../records.ts';
import { consentStatus, emptyLedger, grantConsent, importStatement, revokeConsent, CONSENT_MAX_DAYS } from './bank.ts';

/** The most one import keeps. A larger statement is refused in plain words, never cut short. */
const MAX_IMPORT_CHARS = MAX_STORED_PAYLOAD * 4;
const DEFAULT_CONSENT_DAYS = 90;
export const NO_PROVIDER_LINE = 'No bank provider is linked yet, so Chausar reads only the statement files you import.';

function accountLabel(value: unknown): string {
  return singleLine(value, 'The account name', { min: 1, max: 80 });
}

function countryOf(venture: VentureRecord | null) {
  const country = venture?.country ?? null;
  check(country, 'INVALID_VENTURE_REQUEST', 'Choose the country of your business first, so Chausar knows its currency.');
  return country;
}

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function findAccount(tx: VentureTx, label: string): BankAccountRecord | undefined {
  return tx.list('venture-bank-account').find(account => sameLabel(account.label, label));
}

/** Every transaction already kept for an account, in import order. */
function keptTransactions(tx: VentureTx, accountId: string): BankTransactionData[] {
  return tx.list('venture-bank-import').filter(item => item.accountId === accountId).flatMap(item => item.transactions);
}

/** venture.bank.import { csv, account } (admin, inside the app): adds a statement file, counting each transaction once. */
export async function bankImport(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankImportResult> {
  requireAppChannel(ctx, 'venture.bank.import');
  const body = exactPayload(payload, ['csv', 'account'], ['csv', 'account']);
  check(typeof body.csv === 'string', 'BANK_STATEMENT_INVALID', 'Choose a statement file.');
  const csv = body.csv;
  const label = accountLabel(body.account);
  return ventureAction(deps, ctx, 'admin', 'bank.import', tx => {
    const country = countryOf(tx.venture);
    const options = { currency: country.currency, minorDigits: country.minorDigits, dateOrder: country.dateOrder };
    const account = findAccount(tx, label) ?? tx.put<BankAccountRecord>({ ...tx.base('venture-bank-account'), label, currency: country.currency, consent: null, polls: [] });
    const ledger = { ...emptyLedger(account.label, account.currency), transactions: keptTransactions(tx, account.id) };
    const result = importStatement(ledger, csv, options);
    check(JSON.stringify(result.added).length <= MAX_IMPORT_CHARS, 'BANK_STATEMENT_INVALID',
      'This statement holds more rows than Chausar keeps in one import. Download it a month at a time and import each one.');
    tx.put<BankImportRecord>({
      ...tx.base('venture-bank-import'), accountId: account.id, fileDigest: createHash('sha256').update(csv, 'utf8').digest('hex'),
      transactions: result.added, duplicates: result.duplicates, rejected: result.rejected, line: result.line,
    });
    return {
      account: account.label, accountId: account.id, added: result.added.length, duplicates: result.duplicates,
      rejected: result.rejected, line: result.line, transactions: result.ledger.transactions.length,
    };
  });
}

/**
 * venture.bank.consent { account, days?, revoke? } (admin, inside the app): gives read-only access with an end date
 * (one to 365 days, 90 when left out), or stops it. No provider is linked, so it is kept for when one is.
 */
export async function bankConsent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankConsentView> {
  requireAppChannel(ctx, 'venture.bank.consent');
  const body = exactPayload(payload, ['account', 'days', 'revoke'], ['account']);
  const label = accountLabel(body.account);
  check(body.revoke === undefined || typeof body.revoke === 'boolean', 'INVALID_VENTURE_REQUEST', 'revoke must be true or false.');
  const revoke = body.revoke === true;
  check(!(revoke && body.days !== undefined), 'INVALID_VENTURE_REQUEST', 'Either give consent for some days or stop it, not both.');
  const days = body.days === undefined ? DEFAULT_CONSENT_DAYS : smallInteger(body.days, 'Days', 1, CONSENT_MAX_DAYS);
  return ventureAction(deps, ctx, 'admin', 'bank.consent', tx => {
    const country = countryOf(tx.venture);
    let account = findAccount(tx, label);
    if (revoke) {
      check(account?.consent, 'INVALID_VENTURE_REQUEST', 'There is no bank consent to stop for this account.');
      account = tx.replace<BankAccountRecord>({ ...account, consent: revokeConsent(account.consent, tx.now) });
    } else {
      account ??= tx.put<BankAccountRecord>({ ...tx.base('venture-bank-account'), label, currency: country.currency, consent: null, polls: [] });
      const consent = grantConsent({ id: `${account.id}.consent`, provider: null, accountLabel: account.label, grantedAt: tx.now, days });
      account = tx.replace<BankAccountRecord>({ ...account, consent });
    }
    const consent = account.consent!;
    return { account: account.label, accountId: account.id, consent, status: consentStatus(consent, new Date(tx.now), country.dateOrder), provider: NO_PROVIDER_LINE };
  });
}
