// Chausar playbook: trading journal (wave 6, 6E7 / D49). The code receipts for a journal and a tax pack, in the work
// receipt shape (operation work.totals): every figure, the steps that add it up with the rule and source behind each,
// and the numbers a draft may quote. Browser-safe, so the fake engine builds the same receipt. Written for Chausar.
import { digest } from '../../../portable.ts';
import { formatMoney } from '../../../owner-format.ts';
import type { ChargeLine, Journal } from './journal.ts';
import type { TaxPack } from './tax-pack.ts';
import { EXCHANGE_PERIODS, GST, SEBI_FEE, STAMP_DUTY, STT_PERIODS, BROKER_RATES, type BrokerId } from './rates.ts';

type Figure = { key: string; label: string; minor: string; display: string; currency: string; unit: 'money' | 'count' | 'percent' };
const CHARGE_LABELS: Readonly<Record<keyof Omit<ChargeLine, 'total'>, string>> = Object.freeze({
  brokerage: 'Brokerage', stt: 'Securities transaction tax', exchange: 'Exchange transaction charges', sebi: 'SEBI turnover fee',
  ipft: 'Investor protection charge', stamp: 'Stamp duty', dp: 'DP charges', gst: 'GST',
});
const sourceLine = (s: { title: string; read: string; checkedOn: string }) => `${s.title}; read ${s.checkedOn}; ${s.read}`;
function ruleOf(key: keyof Omit<ChargeLine, 'total'>, brokers: readonly BrokerId[]): string {
  if (key === 'stt') return STT_PERIODS.map(p => sourceLine(p.source)).join(' | ');
  if (key === 'exchange' || key === 'ipft') return EXCHANGE_PERIODS.map(p => sourceLine(p.source)).join(' | ');
  if (key === 'sebi') return sourceLine(SEBI_FEE.source);
  if (key === 'stamp') return sourceLine(STAMP_DUTY.source);
  if (key === 'gst') return `${GST.bps / 100}% of brokerage, exchange, SEBI, investor protection and DP charges per contract note line; ${sourceLine(GST.source)}`;
  return brokers.map(b => sourceLine(BROKER_RATES[b].source)).join(' | ');
}
const money = (key: string, label: string, minor: string): Figure => ({ key, label, minor, display: formatMoney(minor, 'INR'), currency: 'INR', unit: 'money' });
const finish = <T extends { digest: string }>(body: T): T => { const { digest: _d, ...rest } = body; return { ...body, digest: digest(rest) }; };

export function journalReceipt(workId: string, sources: readonly { id: string; name: string; digest: string }[], journal: Journal) {
  const keys = Object.keys(CHARGE_LABELS) as (keyof typeof CHARGE_LABELS)[];
  const realised = (kind: string) => String(journal.realised.filter(lot => lot.kind === kind && !lot.needsFmv).reduce((s, lot) => s + BigInt(lot.pnlMinor), 0n));
  const figures: Figure[] = [
    ...keys.map(key => money(key, CHARGE_LABELS[key], journal.totals[key])),
    money('charges-total', 'All charges', journal.totals.total),
    money('intraday-pnl', 'Intraday profit or loss before charges', realised('intraday')),
    money('fno-pnl', 'Futures and options profit or loss before charges', realised('fno')),
    money('capital-pnl', 'Capital gain or loss before charges', realised('capital')),
    { key: 'trades', label: 'Trade legs read', minor: String(journal.legs), display: String(journal.legs), currency: 'INR', unit: 'count' },
  ];
  const steps = [
    ...keys.map(key => ({ op: 'add' as const, inputs: journal.notes.map(note => note.charges[key]), result: journal.totals[key], rule: `${CHARGE_LABELS[key]} per contract note line, rounded half up to the paisa. ${ruleOf(key, journal.brokers)}` })),
    { op: 'add' as const, inputs: keys.map(key => journal.totals[key]), result: journal.totals.total, rule: 'All charges added.' },
    ...(['intraday', 'fno', 'capital'] as const).map(kind => ({ op: 'add' as const, inputs: journal.realised.filter(lot => lot.kind === kind && !lot.needsFmv).map(lot => lot.pnlMinor), result: realised(kind), rule: 'Sale value less cost for each matched lot, first in first out.' })),
  ];
  return finish({ operation: 'work.totals' as const, runRef: { kind: 'delivery' as const, runId: workId }, currency: 'INR',
    inputs: { tables: [...sources], columns: { quantity: 'quantity', value: 'value', side: 'side', date: 'date' }, rowIds: journal.notes.map(note => `${note.date}|${note.exchange}|${note.kind}`) },
    steps, figures, reconciliation: null, allowedNumbers: figures.flatMap(f => [f.minor, f.display]),
    explanation: 'Charges and realised profit or loss worked by code from your tradebook at the dated rates shown. Compare them with your contract notes; brokers can round some charges differently. Chausar never says what to trade.', digest: '' });
}

export function taxPackReceipt(workId: string, sources: readonly { id: string; name: string; digest: string }[], pack: TaxPack) {
  const figures: Figure[] = pack.figures.map(f => ({ key: f.key, label: f.label, minor: f.minor, display: f.display, currency: 'INR', unit: f.unit }));
  const steps = pack.figures.map(f => ({ op: 'add' as const, inputs: [f.minor], result: f.minor, rule: `${f.how} ${f.act}, section ${f.rule.section}, ${f.year}; ${f.rule.source}; ${f.rule.read}.` }));
  return finish({ operation: 'work.totals' as const, runRef: { kind: 'delivery' as const, runId: workId }, currency: 'INR',
    inputs: { tables: [...sources], columns: { year: pack.yearId }, rowIds: pack.figures.map(f => f.key) },
    steps, figures, reconciliation: null, allowedNumbers: figures.flatMap(f => [f.minor, f.display]),
    explanation: `${pack.line} Rules: ${pack.act}, ${pack.year}.`, digest: '' });
}
