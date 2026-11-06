/**
 * The fake engine's money and runs across the businesses on this computer (W4 4J6): venture.money.across and
 * venture.runs.across, with the engine's shapes, lines and keys (platform/runtime/venture/money/across.ts and
 * views/across.ts). The open business is "Open now."; each other one that opens with this computer reads from a sample
 * of what Chausar saved when it was last open, "As of {time}, when you last opened it."; one that needs a passphrase
 * shows nothing. Each figure has a receipt this desk serves. The total is what was invoiced this month, in one currency
 * only. On the hosted app only the open business shows. Times read in Kolkata, as the sample businesses are in India.
 */

import { EngineError, type AcrossLeftOut, type AcrossMoneyView, type AcrossRunsView, type AgingView, type GoalView, type MoneyOverview, type ReceiptLite, type SpendLead, type SpendPolicyView } from './types';
import { inr } from './fake-money';
import type { W4DeskHost } from './fake-w4';
// 4Z3: which currency leads spend, as the engine's money/spend.ts.
import { perUsdOf, rupeesLead, spendLead } from './fake-lead';

export const FAKE_4J6_METHODS: readonly string[] = ['venture.money.across', 'venture.runs.across'];

/** A business's summary as the fake keeps it: amounts in paise, AI spend in micro-dollars. */
interface Sample { asOf: string; month: string; invoiced: number; received: number; owed: number; late: number; spendMicros: number; working: number; waiting: number; stopped: number; needsYou: number }
const SAMPLES: Readonly<Record<string, Sample>> = {
  lumen: { asOf: '2026-10-21T05:00:00.000Z', month: '2026-10', invoiced: 4500000, received: 1200000, owed: 5310000, late: 2, spendMicros: 1250000, working: 1, waiting: 2, stopped: 0, needsYou: 3 },
  ledgerline: { asOf: '2026-10-22T12:30:00.000Z', month: '2026-10', invoiced: 2620000, received: 0, owed: 2620000, late: 0, spendMicros: 410000, working: 0, waiting: 1, stopped: 0, needsYou: 1 },
};
const EMPTY: Omit<Sample, 'asOf' | 'month'> = { invoiced: 0, received: 0, owed: 0, late: 0, spendMicros: 0, working: 0, waiting: 0, stopped: 0, needsYou: 0 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The engine's words, word for word. */
const OPEN_LINE = 'Open now.';
const lockedLine = (name: string) => `${name} is locked with a passphrase, so Chausar shows nothing about it until you open it.`;
const keyMissingLine = (name: string) => `${name} can't open with this computer right now, so Chausar shows nothing about it until you open it.`;
const noneLine = (name: string) => `Chausar has nothing saved about ${name} yet. Open it once and it shows here.`;
const asOfLine = (when: string) => `As of ${when}, when you last opened it.`;

/** '21 Oct 2026, 10:30' in Kolkata (UTC+05:30), as the engine's asOfWords says it. */
function asOfWords(iso: string): string {
  const local = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return `${local.slice(8, 10)} ${MONTHS[Number(local.slice(5, 7)) - 1]!.slice(0, 3)} ${local.slice(0, 4)}, ${local.slice(11, 16)}`;
}
const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const usd = (micros: number) => `USD ${(Math.round(micros / 100) / 10000).toFixed(4)}`;
const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
function notCountedWords(items: readonly AcrossLeftOut[]): string {
  const why = (item: AcrossLeftOut) => (item.why === 'locked' || item.why === 'key-missing' ? 'locked' : item.why === 'unreadable' ? 'could not be read'
    : item.why === 'none' ? 'nothing saved yet' : item.why === 'setting-up' ? 'still being set up' : `saved in ${monthWords(item.month ?? '')}`);
  return items.length ? ` Not counted: ${items.map((item) => `${item.name} (${why(item)})`).join(', ')}.` : '';
}

type Listed = { folder: string; name: string | null; opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing' };
type Seen = { id: string; name: string; open: boolean; opens: Listed['opens']; sample: Sample | null };

export class FakeAcross {
  private readonly host: W4DeskHost;
  private readonly receipts: ReceiptLite[] = [];
  private seq = 900;

  constructor(host: W4DeskHost) { this.host = host; }

  /** A receipt this desk made, for venture.receipt.get. */
  receipt(id: string): ReceiptLite | undefined {
    const found = this.receipts.find((receipt) => receipt.id === id);
    return found ? structuredClone(found) : undefined;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (Object.keys(p).length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    if (method === 'venture.money.across') return this.money();
    if (method === 'venture.runs.across') return this.runs();
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  private newReceipt(label: string, display: string, explanation: string): string {
    const id = `R-0${this.seq++}`;
    this.receipts.push({ id, at: this.host.now(), explanation, stale: false, figures: [{ key: 'total', label, display }] });
    return id;
  }

  /** Another desk's answer, or undefined where the fake has none. */
  private read<T>(method: string): T | undefined {
    try { return this.host.ask(method, {}) as T; } catch { return undefined; }
  }

  /** The open business's money now, from the money desk's own answers (the fake reads its own formatted text back). */
  private ownMoney(): Partial<Sample> {
    const overview = this.read<MoneyOverview>('venture.money.overview');
    const goals = this.read<GoalView>('venture.goals.get');
    const aging = this.read<AgingView>('venture.money.aging');
    const paise = (display: string | undefined) => (display ? Number(display.replace(/[^\d-]/g, '')) : 0);
    const line = (id: 'owed' | 'received' | 'spent') => overview?.lines.find((item) => item.id === id)?.value;
    const usd = /USD\s?(\d+)\.(\d{4})/.exec(line('spent') ?? '');
    return {
      ...(goals ? { invoiced: paise(goals.invoiced.display) } : {}), ...(line('received') ? { received: paise(line('received')) } : {}),
      ...(line('owed') ? { owed: paise(line('owed')) } : {}), ...(aging ? { late: aging.invoices.filter((item) => item.late !== null).length } : {}),
      ...(usd ? { spendMicros: (Number(usd[1]) * 10000 + Number(usd[2])) * 100 } : {}),
    };
  }

  /**
   * 4J20: the spend in rupees at the owner's rate, and the rate in words, as the engine's money/across.ts; none without
   * one. 4Z3: and the spend as the owner's currency leads it.
   */
  private rupees(micros: number, open = true): { spendRupees?: string; spendRate?: string; spendLead?: SpendLead } {
    const policy = this.read<SpendPolicyView>('venture.spend.policy.get');
    const lead = spendLead(micros, policy?.rupeeRate ? perUsdOf(policy.inrPerUsd) : null, rupeesLead(policy?.currencyLead ?? 'auto'));
    // 4Z3: another business's saved summary carries no rate, so its spend is at the open business's rate, said so.
    const rate = lead.beside?.slice(lead.beside.lastIndexOf(' at ') + 4);
    const spendLeadOf = { spendLead: !open && lead.other && rate ? { ...lead, beside: `${lead.other} at the open business's rate, ${rate}` } : lead };
    if (!policy?.inrPerUsd || !policy.rupeeRate) return spendLeadOf;
    const [whole = '0', fraction = ''] = policy.inrPerUsd.split('.');
    const perUsd = Number(whole) * 10000 + Number(fraction.padEnd(4, '0').slice(0, 4));
    return { spendRupees: inr(Math.floor((micros * perUsd) / 100_000_000 + 0.5)), spendRate: policy.rupeeRate, ...spendLeadOf };
  }

  /** The open business first, then the others on this computer (none on the hosted app). */
  private seen(): Seen[] {
    const current = this.host.current();
    const listed: Listed[] = (this.host.businesses?.() ?? []).map((item) => ({ folder: item.id, name: item.name, opens: item.opens as Listed['opens'] }));
    const open = listed.find((item) => item.folder === current);
    const now = this.host.now();
    // The open business's needs-you count is Today's, as the engine's is.
    const needsYou = this.host.rows().filter((row) => row.businessId === current && row.kind !== 'locked').length;
    // 4J20: the open business's money from its own records, so it matches its own overview (Invoiced, Received, Owed,
    // AI spend), as the engine's moneyNow reads the open vault; its runs from the sample.
    const base = SAMPLES[current] ?? { ...EMPTY, asOf: now, month: now.slice(0, 7) };
    const mine: Seen = { id: current, name: open?.name ?? current, open: true, opens: 'with-this-computer', sample: { ...base, ...this.ownMoney(), asOf: now, needsYou } };
    const others = this.host.hosted() ? [] : listed.filter((item) => item.folder !== current)
      .map((item): Seen => ({ id: item.folder, name: item.name ?? 'A business', open: false, opens: item.opens, sample: item.opens === 'with-this-computer' ? SAMPLES[item.folder] ?? null : null }));
    return [mine, ...others];
  }

  private withheld(item: Seen): { line: string; key: 'locked' | 'key-missing' | 'none'; why: AcrossLeftOut['why'] } | null {
    if (item.opens === 'needs-passphrase') return { line: lockedLine(item.name), key: 'locked', why: 'locked' };
    if (item.opens === 'key-missing') return { line: keyMissingLine(item.name), key: 'key-missing', why: 'key-missing' };
    return item.sample ? null : { line: noneLine(item.name), key: 'none', why: 'none' };
  }

  private money(): AcrossMoneyView {
    const all = this.seen();
    const month = all[0]!.sample!.month;
    const left: AcrossLeftOut[] = [];
    const counted: Seen[] = [];
    const businesses: AcrossMoneyView['businesses'] = all.map((item) => {
      const hidden = item.open ? null : this.withheld(item);
      if (hidden || !item.sample) {
        left.push({ businessId: item.id, name: item.name, why: hidden?.why ?? 'none', month: null });
        return { businessId: item.id, name: item.name, open: false, locked: hidden?.key === 'locked' || hidden?.key === 'key-missing', asOf: null, line: hidden?.line ?? noneLine(item.name), lineKey: hidden?.key ?? 'none', invoiced: null, received: null, owed: null, late: null, spend: null };
      }
      const s = item.sample;
      const saved = item.open ? '' : `${item.name}, as saved on ${asOfWords(s.asOf)} `;
      const made = (label: string, display: string) => this.newReceipt(label, display, item.open ? `${label}: ${display}.` : `1 saved figure: ${saved}${display}. Added together: ${display}.`);
      if (item.open || s.month === month) counted.push(item); else left.push({ businessId: item.id, name: item.name, why: 'other-month', month: s.month });
      return {
        businessId: item.id, name: item.name, open: item.open, locked: false, asOf: item.open ? null : s.asOf, line: item.open ? OPEN_LINE : asOfLine(asOfWords(s.asOf)), lineKey: item.open ? 'open' : 'as-of',
        invoiced: inr(s.invoiced), received: inr(s.received), owed: inr(s.owed), late: s.late, spend: usd(s.spendMicros), ...this.rupees(s.spendMicros, item.open),
        receipts: {
          invoiced: made(`Invoiced in ${monthWords(s.month)}`, inr(s.invoiced)), received: made('Received', inr(s.received)),
          owed: made('Owed on open invoices', inr(s.owed)), spend: made('AI and tools', usd(s.spendMicros)),
        },
      };
    });
    const sum = counted.reduce((total, item) => total + item.sample!.invoiced, 0);
    const parts = counted.map((item) => `${item.open ? item.name : `${item.name}, as saved on ${asOfWords(item.sample!.asOf)}`} ${inr(item.sample!.invoiced)}`).join('; ');
    const receiptId = this.newReceipt('Invoiced across your businesses', inr(sum), `${counted.length} amounts: ${parts}. Added together: ${inr(sum)}.`);
    const line = `Invoiced in ${monthWords(month)} ${counted.length === 1 ? 'in 1 business' : `across ${counted.length} businesses`}.${notCountedWords(left)}`;
    return { businesses, total: { display: inr(sum), receiptId }, line, lineKey: 'counted', month, counted: counted.length, currencies: ['INR'], notCounted: left };
  }

  private runs(): AcrossRunsView {
    const left: AcrossLeftOut[] = [];
    const businesses: AcrossRunsView['businesses'] = this.seen().map((item) => {
      const hidden = item.open ? null : this.withheld(item);
      if (hidden || !item.sample) {
        left.push({ businessId: item.id, name: item.name, why: hidden?.why ?? 'none', month: null });
        return { businessId: item.id, name: item.name, open: false, locked: hidden?.key === 'locked' || hidden?.key === 'key-missing', asOf: null, line: hidden?.line ?? '', lineKey: hidden?.key ?? 'none', working: null, waiting: null, stopped: null, needsYou: null };
      }
      const s = item.sample;
      return { businessId: item.id, name: item.name, open: item.open, locked: false, asOf: item.open ? null : s.asOf, line: item.open ? OPEN_LINE : asOfLine(asOfWords(s.asOf)), lineKey: item.open ? 'open' : 'as-of', working: s.working, waiting: s.waiting, stopped: s.stopped, needsYou: s.needsYou };
    });
    const shown = businesses.filter((row) => row.working !== null);
    const total = (key: 'working' | 'waiting' | 'stopped' | 'needsYou') => shown.reduce((sum, row) => sum + (row[key] ?? 0), 0);
    const totals = { working: total('working'), waiting: total('waiting'), stopped: total('stopped'), needsYou: total('needsYou'), businesses: shown.length };
    const words = [`${totals.working} running`, `${totals.waiting} waiting`, ...(totals.stopped ? [`${totals.stopped} stopped`] : []), `${totals.needsYou} need you`];
    const where = shown.length === 1 ? 'in 1 business' : `across ${shown.length} businesses`;
    return { businesses, line: `${listWords(words)} ${where}.${notCountedWords(left)}`, totals, notCounted: left };
  }
}
