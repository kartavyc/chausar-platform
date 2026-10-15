/**
 * BK-19, round 4: when core-data's calculator applies the owner's exchange rates, each receipt
 * carries its own "not counted" count (rows in another currency with no rate for their date).
 * `books.rates` then shows the count as the receipts give it, receipt by receipt, beside this
 * lane's own count over the facts. The rates themselves stay entered by the owner here; this
 * lane still converts nothing.
 *
 * Assumed receipt shape (docs/lanes/work-books.md, "Round 4 contracts"):
 *   receipt.coverage.notCounted: { currency: string; rows: number }[]   (currency: a three-letter code)
 * A receipt without the field was worked out before rates were applied, and is not listed.
 */
import type { Context, State } from '../contracts.ts';

export type ReceiptNotCounted = { receiptId: string; operation: string; at: string; notCounted: { currency: string; rows: number }[] };
const MAX_LISTED = 20;

function notCountedOf(receipt: Record<string, any>): { currency: string; rows: number }[] | null {
  const list = receipt?.coverage?.notCounted;
  if (!Array.isArray(list)) return null;
  const rows = list.filter(n => n && /^[A-Z]{3}$/.test(String(n.currency)) && Number.isSafeInteger(n.rows) && n.rows >= 0).slice(0, 50)
    .map(n => ({ currency: n.currency as string, rows: n.rows as number }));
  return rows.length === list.length ? rows : null;
}

/** The caller's own receipts that carry the count; `available` once any of them does. Newest first, at most twenty with something not counted. */
export function receiptsNotCounted(state: State, ctx: Context): { available: boolean; receipts: ReceiptNotCounted[] } {
  let available = false; const listed: ReceiptNotCounted[] = [];
  for (const receipt of [...state.receipts].reverse()) {
    if (!receipt || receipt.memberId !== ctx.memberId || typeof receipt.id !== 'string') continue;
    const counts = notCountedOf(receipt); if (counts === null) continue;
    available = true;
    const missing = counts.filter(n => n.rows > 0);
    if (missing.length > 0 && listed.length < MAX_LISTED) listed.push({ receiptId: receipt.id, operation: typeof receipt.operation === 'string' ? receipt.operation.slice(0, 80) : '',
      at: typeof receipt.createdAt === 'string' ? receipt.createdAt : '', notCounted: missing });
  }
  return { available, receipts: listed.filter(r => r.at !== '') };
}
