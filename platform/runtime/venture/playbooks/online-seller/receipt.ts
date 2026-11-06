// Chausar seller tool receipts. Independent implementation, research ideas from sealeap (MIT).
import { sellerNumbers, sellerPercent } from './model.ts';
import { digest } from '../../records.ts';
import { formatMinor } from '../../../currency.ts';
import type { WorkReceiptRecord, WorkRunRef } from '../../contracts.ts';
import type { WorkReceiptDraft } from '../../delivery/harness/work.ts';
/** The numeric fields of a seller check, kept exactly as the deterministic calculator returned them. */
export function sellerFigures(result: unknown): Record<string, string> {
  return sellerNumbers(result);
}
/** A full source-backed receipt, so every downstream figure cites code rather than prose. */
export function sellerWorkReceipt(input: { result: unknown; runRef: WorkRunRef; sourceId: string; sourceName: string; sourceDigest: string; additionalSources?: { id: string; name: string; digest: string }[] }): WorkReceiptDraft {
  const values = sellerFigures(input.result);
  const figures = Object.entries(values).map(([key, minor]) => ({ key, label: key.replace(/Minor\d*$/, '').replace(/([A-Z])/g, ' $1').trim(), minor,
    display: key.includes('Minor') ? formatMinor(minor, 'INR') : key.endsWith('Bps') ? sellerPercent(minor) : minor,
    currency: 'INR', unit: key.includes('Minor') ? 'money' as const : 'count' as const }));
  const receipt = { operation: 'seller.compute' as WorkReceiptRecord['operation'], runRef: input.runRef, currency: 'INR',
    inputs: { tables: [{ id: input.sourceId, name: input.sourceName, digest: input.sourceDigest }, ...(input.additionalSources ?? [])], columns: { source: input.sourceName }, rowIds: [] },
    steps: figures.map(figure => ({ op: 'compare' as const, inputs: [input.sourceId, ...(input.additionalSources ?? []).map(source => source.id)], result: figure.minor, rule: 'Seller source export, integer minor units, half-up per line.' })),
    figures, reconciliation: null, allowedNumbers: figures.flatMap(f => [f.minor, f.display]), explanation: 'Computed from the seller export. Tax and legal confirmations are required before client use.', digest: '' };
  const { digest: _unset, ...covered } = receipt; receipt.digest = digest(covered); return receipt;
}
