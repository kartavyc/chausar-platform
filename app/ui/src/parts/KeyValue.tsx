/**
 * KeyValue: two columns of name and value. A value may be a figure with its receipt,
 * or text shown as written.
 */

import type { ReactNode } from 'react';
import type { FigureOrMissing } from '../app/presentation.ts';
import { Figure } from './Figure';
import s from './KeyValue.module.css';

export interface Pair {
  name: string;
  value?: string | undefined;
  figure?: FigureOrMissing | undefined;
  /** Draw the value in the number face. */
  mono?: boolean | undefined;
  /** Indent under the pair above, for a group left out of a receipt. */
  indent?: boolean | undefined;
  /** Extra content such as a label. */
  after?: ReactNode;
}

export interface KeyValueProps {
  pairs: ReadonlyArray<Pair>;
  /** Required: a pair with a figure always opens its receipt. */
  onReceipt: (receiptId: string) => void;
  /** Values at the right edge, as on a receipt. */
  align?: 'left' | 'right' | undefined;
  className?: string | undefined;
}

export function KeyValue({ pairs, onReceipt, align = 'left', className }: KeyValueProps) {
  return (
    <dl className={[s.list, s[align], className].filter(Boolean).join(' ')}>
      {pairs.map((p, i) => (
        <div key={`${p.name}-${i}`} className={[s.pair, p.indent ? s.indent : ''].join(' ')}>
          <dt className={s.name}>{p.name}</dt>
          <dd className={[s.value, p.mono ? 'fig' : ''].join(' ')}>
            {p.figure !== undefined ? <Figure value={p.figure} onReceipt={onReceipt} /> : p.value}
            {p.after}
          </dd>
        </div>
      ))}
    </dl>
  );
}
