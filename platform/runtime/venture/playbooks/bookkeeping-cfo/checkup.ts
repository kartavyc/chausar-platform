// Spending-only check-up ideas from bankmcp (MIT); original Chausar code, no investment advice.
import { ChausarError } from '../../../contracts.ts';
export type LedgerRow = { id: string; payee: string; on: string; amountMinor: string; direction: 'in' | 'out' };
export type LedgerFinding = { code: 'DUPLICATE_IMPORT' | 'LEDGER_SIGN_FLIPPED' | 'LEDGER_INVALID'; rowIds: string[] };
export type SpendingCandidate = { reason: 'large' | 'duplicate' | 'first-payee' | 'subscription-rise'; rowIds: string[]; amountMinor: string };
const day = (on: string) => Date.parse(`${on}T00:00:00.000Z`) / 86400000;
const key = (payee: string) => payee.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');

/** Clean/adversarial finance rehearsal validation, before any arithmetic. */
export function validateLedger(rows: readonly LedgerRow[]): LedgerFinding[] {
  const findings: LedgerFinding[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) findings.push({ code: 'DUPLICATE_IMPORT', rowIds: [row.id] });
    ids.add(row.id);
    if (/^-\d+$/.test(row.amountMinor)) findings.push({ code: 'LEDGER_SIGN_FLIPPED', rowIds: [row.id] });
    else if (!/^\d{1,30}$/.test(row.amountMinor) || !row.id || !key(row.payee) || !['in', 'out'].includes(row.direction) || !/^\d{4}-\d{2}-\d{2}$/.test(row.on) || !Number.isFinite(day(row.on)) || new Date(`${row.on}T00:00:00.000Z`).toISOString().slice(0, 10) !== row.on) findings.push({ code: 'LEDGER_INVALID', rowIds: [row.id] });
  }
  return findings;
}

/** Monthly and yearly repeat candidates, read-only, with exact row evidence and BigInt spending totals. */
export function moneyCheckup(rows: readonly LedgerRow[], month: string, thresholdMinor: string) {
  const findings = validateLedger(rows);
  if (findings.length) throw new ChausarError(findings[0].code, 'The ledger has duplicate imports, an invalid row or a flipped sign. Fix the source before using its figures.');
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || !/^\d{1,30}$/.test(thresholdMinor)) throw new ChausarError('CHECKUP_INPUT_INVALID', 'Choose the month and a non-negative large-payment threshold.');
  const through = rows.filter(row => row.on.slice(0, 7) <= month);
  const outs = through.filter(row => row.direction === 'out').sort((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
  const current = outs.filter(row => row.on.startsWith(month));
  const incoming = through.filter(row => row.direction === 'in' && row.on.startsWith(month));
  const groups = new Map<string, LedgerRow[]>();
  for (const row of outs) groups.set(key(row.payee), [...(groups.get(key(row.payee)) ?? []), row]);
  const subscriptions: { payee: string; cadence: 'monthly' | 'yearly'; latestMinor: string; yearlyMinor: string; riseMinor: string; new: boolean; rowIds: string[] }[] = [];
  for (const group of groups.values()) {
    // Nearby equal debits are possible duplicates, not a second subscription cycle.
    const unique = group.filter((row, i) => i === 0 || day(row.on) - day(group[i - 1].on) > 3);
    const latest = unique.at(-1), previous = unique.at(-2);
    if (!latest || !previous || !latest.on.startsWith(month)) continue;
    const gap = day(latest.on) - day(previous.on);
    const cadence = gap >= 26 && gap <= 35 ? 'monthly' : gap >= 350 && gap <= 380 ? 'yearly' : null;
    const latestMinor = BigInt(latest.amountMinor), before = BigInt(previous.amountMinor);
    const difference = latestMinor >= before ? latestMinor - before : before - latestMinor;
    if (!cadence || before === 0n || difference * 100n > before * 25n) continue;
    subscriptions.push({ payee: latest.payee, cadence, latestMinor: String(latestMinor), yearlyMinor: String(latestMinor * (cadence === 'monthly' ? 12n : 1n)), riseMinor: String(latestMinor > before ? latestMinor - before : 0n), new: unique.length === 2, rowIds: unique.map(row => row.id) });
  }
  const unusual: SpendingCandidate[] = [];
  for (const row of current) {
    if (BigInt(row.amountMinor) >= BigInt(thresholdMinor)) unusual.push({ reason: 'large', rowIds: [row.id], amountMinor: row.amountMinor });
    const prior = outs.find(other => other.id !== row.id && other.on <= row.on && other.amountMinor === row.amountMinor && key(other.payee) === key(row.payee) && day(row.on) - day(other.on) <= 3);
    if (prior && (prior.on < row.on || prior.id < row.id)) unusual.push({ reason: 'duplicate', rowIds: [prior.id, row.id], amountMinor: row.amountMinor });
    if (!outs.some(other => key(other.payee) === key(row.payee) && other.on.slice(0, 7) < month)) unusual.push({ reason: 'first-payee', rowIds: [row.id], amountMinor: row.amountMinor });
  }
  const rises: SpendingCandidate[] = subscriptions.filter(row => BigInt(row.riseMinor) > 0n).map(row => ({ reason: 'subscription-rise', rowIds: row.rowIds, amountMinor: row.riseMinor }));
  const total = (list: readonly LedgerRow[]) => String(list.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n));
  return { month, totalOutMinor: total(current), totalInMinor: total(incoming), subscriptions, unusual, savings: [...rises, ...unusual].slice(0, 3), readOnly: true as const };
}
