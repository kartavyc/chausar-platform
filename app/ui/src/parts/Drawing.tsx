/**
 * Drawing: a drawn explanation of a mechanism, from a small typed description, never from
 * free SVG. Squares, hairlines and thin arrows only.
 * - At most six nodes. Each node is a square in one of the marks and a label of one to four
 *   words.
 * - Links are typed: `arrow` (a thin line with a head) or `dashed` (a dashed line with a
 *   head, for something that may happen). Both ends must name nodes in the drawing.
 * - Laid out deterministically in the order given, along a row or down a column. Neighbours
 *   are joined straight; a link that skips nodes bows to one side.
 * - A description that breaks a rule is refused: the fixed sentence is drawn instead and
 *   nothing of the description is.
 * The picture is hidden from screen readers; the same nodes and links are written out.
 */

import { useId } from 'react';
import type { Mark } from '../app/presentation.ts';
import { useT } from '../app/text';
import s from './Drawing.module.css';

export const DRAWING_MAX_NODES = 6;
export const DRAWING_MAX_WORDS = 4;

export interface DrawingNode {
  readonly id: string;
  readonly mark: Mark;
  /** One to four words, already localised. */
  readonly label: string;
}

export interface DrawingLink {
  readonly from: string;
  readonly to: string;
  readonly kind: 'arrow' | 'dashed';
}

export interface DrawingDescription {
  readonly layout: 'row' | 'column';
  readonly nodes: ReadonlyArray<DrawingNode>;
  readonly links: ReadonlyArray<DrawingLink>;
  /** One sentence saying what the drawing shows. */
  readonly sentence: string;
}

export interface DrawingProps {
  drawing: DrawingDescription;
  className?: string | undefined;
}

function words(label: string): string[] {
  return label.trim().split(/\s+/).filter((w) => w.length > 0);
}

/** Whether a description may be drawn. */
export function drawingAllowed(d: DrawingDescription): boolean {
  if (d.layout !== 'row' && d.layout !== 'column') return false;
  if (d.nodes.length === 0 || d.nodes.length > DRAWING_MAX_NODES) return false;
  const ids = new Set<string>();
  for (const node of d.nodes) {
    const n = words(node.label).length;
    if (n === 0 || n > DRAWING_MAX_WORDS || ids.has(node.id)) return false;
    ids.add(node.id);
  }
  return d.links.every((l) => (l.kind === 'arrow' || l.kind === 'dashed') && ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
}

/* Geometry, in the drawing's own units. */
const SQ = 10;
const STEP_X = 136;
const STEP_Y = 56;
const PAD = 16;
const GAP = 6;
const BOW = 18;

export function Drawing({ drawing: d, className }: DrawingProps) {
  const t = useT();
  const marker = useId().replace(/:/g, '');

  if (!drawingAllowed(d)) {
    return <p className={[s.refused, className].filter(Boolean).join(' ')} role="note">{t('DRAWING.refused')}</p>;
  }

  const row = d.layout === 'row';
  const n = d.nodes.length;
  const width = row ? PAD * 2 + STEP_X * (n - 1) + STEP_X : 320;
  const height = row ? 96 : PAD * 2 + STEP_Y * (n - 1) + SQ;
  const at = (i: number) => (row ? { x: PAD + STEP_X / 2 + i * STEP_X, y: 36 } : { x: PAD + 40, y: PAD + SQ / 2 + i * STEP_Y });
  const index = new Map(d.nodes.map((node, i) => [node.id, i]));
  const label = (id: string) => d.nodes[index.get(id) ?? 0]?.label ?? '';

  const path = (from: number, to: number): string => {
    const a = at(from);
    const b = at(to);
    const span = Math.abs(to - from);
    const dir = to > from ? 1 : -1;
    const edge = SQ / 2 + GAP;
    if (row) {
      if (span === 1) return `M ${a.x + dir * edge} ${a.y} L ${b.x - dir * edge} ${b.y}`;
      /* Skips bow above the row; the labels sit below. */
      const y = a.y - edge;
      return `M ${a.x} ${y} Q ${(a.x + b.x) / 2} ${y - BOW * span} ${b.x} ${y}`;
    }
    if (span === 1) return `M ${a.x} ${a.y + dir * edge} L ${b.x} ${b.y - dir * edge}`;
    /* Skips bow to the left; the labels sit to the right. */
    const x = a.x - edge;
    return `M ${x} ${a.y} Q ${x - BOW * span} ${(a.y + b.y) / 2} ${x} ${b.y}`;
  };

  return (
    <figure className={[s.drawing, className].filter(Boolean).join(' ')}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" focusable="false">
        <defs>
          <marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M1 1 7 4 1 7" className={s.head} />
          </marker>
        </defs>
        {d.links.map((l, i) => (
          <path
            key={`${l.from}-${l.to}-${i}`}
            d={path(index.get(l.from) ?? 0, index.get(l.to) ?? 0)}
            className={[s.link, l.kind === 'dashed' ? s.dashed : ''].join(' ')}
            markerEnd={`url(#${marker})`}
            data-link={l.kind}
          />
        ))}
        {d.nodes.map((node, i) => {
          const p = at(i);
          const w = words(node.label);
          const lines = w.length > 2 && row ? [w.slice(0, 2).join(' '), w.slice(2).join(' ')] : [w.join(' ')];
          return (
            <g key={node.id} data-node={node.id}>
              <rect x={p.x - SQ / 2} y={p.y - SQ / 2} width={SQ} height={SQ} rx={1.5} className={[s.square, s[node.mark]].join(' ')} />
              <text className={s.label} x={row ? p.x : p.x + SQ / 2 + 12} y={row ? p.y + SQ / 2 + 18 : p.y + 4} textAnchor={row ? 'middle' : 'start'}>
                {lines.map((line, k) => (
                  <tspan key={k} x={row ? p.x : p.x + SQ / 2 + 12} dy={k === 0 ? 0 : 16}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={s.caption}>{d.sentence}</figcaption>
      <ul className="sr">
        {d.nodes.map((node) => (
          <li key={node.id}>{t('DRAWING.node', { label: node.label, state: t(`MARK.${node.mark}`) })}</li>
        ))}
        {d.links.map((l, i) => (
          <li key={`link-${i}`}>{t(l.kind === 'dashed' ? 'DRAWING.link.dashed' : 'DRAWING.link.arrow', { from: label(l.from), to: label(l.to) })}</li>
        ))}
      </ul>
    </figure>
  );
}
