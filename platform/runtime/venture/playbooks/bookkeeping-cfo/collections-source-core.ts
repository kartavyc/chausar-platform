// Client collections source rows, original Chausar CSV validation shared with the browser fake.
import { csvRows } from '../../../csv.ts';
export type DebtorInvoice = { id: string; number: string; debtor: string; on: string; dueOn: string; amountMinor: string };
export type DebtorPayment = { id: string; invoiceId: string; amountMinor: string; receivedOn: string; cleared: boolean };
export type CollectionsSource = { invoices: DebtorInvoice[]; payments: DebtorPayment[] };
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
/** Returns null for an unrelated file; a malformed declared collections ledger is refused. */
export function readCollectionsSource(text: string): CollectionsSource | null {
  const [header = [], ...rows] = csvRows(text);
  if (!['kind','id','invoice','debtor','on','dueOn','amount','state'].every(name => header.includes(name))) return null;
  if (rows.length > 5000 || new Set(header).size !== header.length) throw new Error('Use a bounded ledger with distinct columns.');
  const invoices: DebtorInvoice[] = [], payments: DebtorPayment[] = [], ids = new Set<string>();
  for (const cells of rows) {
    const value = (key: string) => (cells[header.indexOf(key)] ?? '').trim();
    const id = value('id'), on = value('on'), amount = value('amount'), kind = value('kind');
    if (!id || id.length > 120 || ids.has(id) || !validDay(on) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) throw new Error('Use distinct source ids, valid dates and exact non-negative rupee amounts.');
    ids.add(id);
    const [whole, fraction = ''] = amount.split('.');
    const amountMinor = String(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
    if (kind === 'invoice') {
      if (!value('invoice') || !value('debtor') || !validDay(value('dueOn')) || value('state') !== 'open') throw new Error('An open debtor invoice needs its number, debtor and due date.');
      invoices.push({ id, number: value('invoice'), debtor: value('debtor'), on, dueOn: value('dueOn'), amountMinor });
    } else if (kind === 'payment') {
      if (!value('invoice') || !['pending','cleared'].includes(value('state'))) throw new Error('A payment needs its source invoice id and pending or cleared state.');
      payments.push({ id, invoiceId: value('invoice'), amountMinor, receivedOn: on, cleared: value('state') === 'cleared' });
    } else throw new Error('Use invoice or payment source rows.');
  }
  if (payments.some(payment => !invoices.some(invoice => invoice.id === payment.invoiceId))) throw new Error('Every payment must name a source invoice in the same snapshot.');
  return { invoices, payments };
}
