import type { ReactNode } from 'react';
import type { ChiefLineAmount } from '../engine/types';
import { Figure } from './Figure';

/**
 * An engine line with each amount it names as a Figure with its receipt, cut at the offsets the engine sends, and only
 * where the words there are the amount's own (an offset that does not match is skipped). Chats' last lines and the
 * command bar's chat snippets (C2) both draw it. `mark` wraps the first place a word sits, outside any amount.
 */
export function LineWithAmounts({ line, amounts, mark }: { line: string; amounts: readonly ChiefLineAmount[]; mark?: { start: number; length: number } | null }) {
  const out: ReactNode[] = [];
  let at = 0;
  const words = (from: number, to: number) => {
    if (to <= from) return;
    const hit = mark && mark.start >= from && mark.start + mark.length <= to ? mark : null;
    if (!hit) { out.push(line.slice(from, to)); return; }
    if (hit.start > from) out.push(line.slice(from, hit.start));
    out.push(<mark key={`m${hit.start}`}>{line.slice(hit.start, hit.start + hit.length)}</mark>);
    if (hit.start + hit.length < to) out.push(line.slice(hit.start + hit.length, to));
  };
  for (const amount of [...amounts].sort((a, b) => a.start - b.start)) {
    if (amount.start < at || line.slice(amount.start, amount.start + amount.length) !== amount.text) continue;
    words(at, amount.start);
    out.push(<Figure key={amount.start} value={amount.text} receiptId={amount.receiptId} />);
    at = amount.start + amount.length;
  }
  words(at, line.length);
  return <>{out}</>;
}
