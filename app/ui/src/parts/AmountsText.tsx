import { Fragment, type ReactNode } from 'react';
import { openSheet } from '../shell/navigation';
import type { DraftAmount } from '../engine/types';
import { Figure } from './Figure';
import { ModelEstimate } from './ModelEstimate';

/**
 * One-shot C4 task 16: a draft's quoted words, with each amount the engine matched drawn where it stands: the figure face
 * with its receipt mark, or the "model estimate" label on one no receipt backs. The screen looks only for what the engine
 * listed and works nothing out; everything else is the draft's own words.
 */
export function AmountsText({ text, amounts, onReceipt }: { text: string; amounts: readonly DraftAmount[]; onReceipt?: ((id: string) => void) | undefined }): ReactNode {
  if (amounts.length === 0) return text;
  // The longest first, so an amount that holds a shorter one is found whole.
  const ordered = [...amounts].sort((a, b) => b.display.length - a.display.length);
  const pieces: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let at = -1;
    let found: DraftAmount | undefined;
    for (const amount of ordered) {
      const index = rest.indexOf(amount.display);
      if (index >= 0 && (at < 0 || index < at)) { at = index; found = amount; }
    }
    if (!found) { pieces.push(rest); break; }
    pieces.push(rest.slice(0, at));
    pieces.push(<Fragment key={key += 1}><AmountMark amount={found} onReceipt={onReceipt} /></Fragment>);
    rest = rest.slice(at + found.display.length);
  }
  return pieces;
}

function AmountMark({ amount, onReceipt }: { amount: DraftAmount; onReceipt?: ((id: string) => void) | undefined }) {
  if (amount.estimate || !amount.receiptId) return <ModelEstimate value={amount.display} />;
  const open = amount.receiptKind === 'work' ? (id: string) => openSheet('work-receipt', id) : onReceipt;
  return <Figure value={amount.display} receiptId={amount.receiptId} onReceipt={open} />;
}
