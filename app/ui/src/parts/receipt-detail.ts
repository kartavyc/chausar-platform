/**
 * The receipt sheets' small print: `todayx.receiptDetail` for the one open receipt, read through
 * the host's rpc, checked with `isReceiptDetailReply`, and merged into the view with
 * `withReceiptDetail`. A late reply for another receipt, a reply that fails the check, a refusal
 * or a missing method leaves the receipt as it was: nothing is filled in.
 */
import { useEffect, useState } from 'react';
import type { PlaceRpc } from '../places/types.ts';
import type { Language } from '../app/presentation.ts';
import { isReceiptDetailReply, type ReceiptDetailReply } from '../bridge/todayx-contract.ts';
import { withReceiptDetail, type ReceiptView } from '../bridge/receipt-view.ts';

export const RECEIPT_DETAIL_METHOD = 'todayx.receiptDetail';

export function useReceiptDetail(rpc: PlaceRpc | undefined, receiptId: string | null): ReceiptDetailReply | null {
  const [held, setHeld] = useState<ReceiptDetailReply | null>(null);
  useEffect(() => {
    setHeld(null);
    if (rpc === undefined || receiptId === null) return;
    let live = true;
    rpc.request(RECEIPT_DETAIL_METHOD, { receiptId }).then(
      reply => { if (live && isReceiptDetailReply(reply) && reply.receiptId === receiptId) setHeld(reply); },
      () => { if (live) setHeld(null); },
    );
    return () => { live = false; };
  }, [rpc, receiptId]);
  return held !== null && held.receiptId === receiptId ? held : null;
}

/** The view with the detail merged in, or the view unchanged. Never throws. */
export function receiptWithDetail(view: ReceiptView | null, detail: ReceiptDetailReply | null, language: Language, timeZone: string | null,
  t: (key: string) => string): ReceiptView | null {
  if (view === null || detail === null || timeZone === null) return view;
  try {
    return withReceiptDetail(view, detail, { language, timeZone, allowedByWords: { 'read-access': t('RECEIPT.allowed.read-access'), 'send-approved': t('RECEIPT.allowed.send-approved') },
      cashWords: { reason: t('MISSING.cash-not-captured'), rows: t('MISSING.not-counted') } });
  } catch { return view; }
}
