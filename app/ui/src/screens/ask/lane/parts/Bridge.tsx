/**
 * Bridge: why a figure moved. The earlier figure, then one bar per measured cause (up or
 * down from where the one before ended), then the later figure. Laid on its side, one line
 * per bar, so long names and Hindi keep their room and a phone width still holds it.
 *
 * The earlier figure is grey, a rise is a filled grey bar, a fall is an open bar, and the
 * later figure is ink; the direction is also in words, never only in shape. Every bar opens
 * its receipt and the written amount beside it is a figure that opens the same receipt.
 * Positions are exact (BigInt) until normalised, as in parts/charts/scale.ts. When the
 * causes do not lead exactly from the earlier figure to the later one, nothing is drawn:
 * the values are written out instead, so a bridge never suggests an exactness it lacks.
 */
import type { KeyboardEvent } from 'react';
import type { ChartValue, Figure as FigureValue } from '../../../../app/presentation.ts';
import { Figure } from '../../../../parts/Figure';
import { Mark, Target, ValueList } from '../../../../parts/charts/marks';
import { exactExtent, exactLinear, includeZero, toExact, BAR_RADIUS } from '../../../../parts/charts/scale.ts';
import s from './Bridge.module.css';

export interface BridgeBar { readonly id: string; readonly label: string; readonly value: FigureValue }
export interface BridgeProps {
  /** One sentence for screen readers that states what the chart shows. */
  sentence: string;
  start: BridgeBar;
  causes: ReadonlyArray<BridgeBar>;
  end: BridgeBar;
  /** The words for a rise and a fall, from the screen's catalogue. */
  words: { up: string; down: string; notExact: string };
  onReceipt: (receiptId: string) => void;
  className?: string | undefined;
}

const W = 240, H = 14, PAD = 2;
type Placed = { bar: BridgeBar; from: bigint; to: bigint; tone: 'start' | 'up' | 'down' | 'end' };

/** Where each bar starts and ends, or null when the causes do not lead exactly to the end. */
export function placeBridge(start: BridgeBar, causes: ReadonlyArray<BridgeBar>, end: BridgeBar): Placed[] | null {
  const first = toExact(start.value.exact), last = toExact(end.value.exact);
  if (first === null || last === null) return null;
  const placed: Placed[] = [{ bar: start, from: 0n, to: first, tone: 'start' }];
  let at = first;
  for (const cause of causes) {
    const change = toExact(cause.value.exact);
    if (change === null) return null;
    placed.push({ bar: cause, from: at, to: at + change, tone: change < 0n ? 'down' : 'up' });
    at += change;
  }
  if (at !== last) return null;
  placed.push({ bar: end, from: 0n, to: last, tone: 'end' });
  return placed;
}

export function Bridge({ sentence, start, causes, end, words, onReceipt, className }: BridgeProps) {
  const placed = placeBridge(start, causes, end);
  if (placed === null) {
    const values: ChartValue[] = [start, ...causes, end].map(b => ({ id: b.id, label: b.label, value: b.value }));
    return <div className={className}><p className={s.note}>{words.notExact}</p><ValueList values={values} onReceipt={onReceipt} /></div>;
  }
  const domain = includeZero(exactExtent(placed.flatMap(p => [p.from, p.to]))!);
  const x = exactLinear(domain.min, domain.max, PAD, W - PAD);
  const zero = x(0n);
  /* Up and Down move from bar to bar, as inside any chart. */
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const marks = Array.from(e.currentTarget.querySelectorAll<SVGGElement>('g[role="button"]'));
    const at = marks.indexOf(e.target as SVGGElement);
    if (at < 0) return;
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? at - 1 : -1;
    if (next < 0 || next >= marks.length) return;
    e.preventDefault();
    marks[next]!.focus();
  };
  return (
    <figure className={[s.bridge, className].filter(Boolean).join(' ')} aria-label={sentence}>
      <ul className={s.rows} onKeyDown={onKey}>
        {placed.map(p => {
          const a = x(p.from < p.to ? p.from : p.to), b = x(p.from < p.to ? p.to : p.from);
          const width = Math.max(b - a, 1);
          return (
            <li key={p.bar.id} className={[s.row, p.tone === 'end' ? s.endRow : ''].join(' ')} data-bridge-bar={p.tone}>
              <span className={s.label}>{p.bar.label}</span>
              <svg className={s.track} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <line className={s.zero} x1={zero} x2={zero} y1={0} y2={H} />
                <Mark label={p.bar.label} display={p.bar.value.display} spoken={p.bar.value.spoken} receiptId={p.bar.value.receiptId} onReceipt={onReceipt}>
                  <rect className={[s.bar, s[p.tone]].join(' ')} x={a} y={PAD} width={width} height={H - PAD * 2} rx={Math.min(BAR_RADIUS / 2, width / 2)} />
                  <Target cx={a + width / 2} cy={H / 2} />
                </Mark>
              </svg>
              <span className={s.amount}>
                {(p.tone === 'up' || p.tone === 'down') && <span className={s.direction}>{p.tone === 'up' ? words.up : words.down}</span>}
                <Figure value={p.bar.value} onReceipt={onReceipt} />
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
