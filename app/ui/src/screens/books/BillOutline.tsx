/**
 * Bill photo, round 4 (WK-13/BK-18): outlines from the reader's word boxes. A field is outlined
 * where its words were read (per mille of the page), not as the line's band; every page read
 * is outlined, not only the first. Page 1 is drawn over the person's own picture; each later
 * page gets its own panel with every word read on it as a faint box, so the field outlines
 * stand on the page's own layout. Without word boxes (an older reader) the line band is drawn
 * as before.
 */
import type { BillField, BillRead } from './contract.ts';
import type { Outline } from './contract-r4b.ts';
import { fill } from './shared.tsx';
import { useR4bWords } from './words-r4b.ts';
import b from './BillPhoto.module.css';
import o from './BillOutline.module.css';
import type { Language } from '../../app/presentation.ts';

export type Region = { key: string; field: BillField };

/** Every field the reader placed, keyed for the form's focus. */
export function regionsOf(read: BillRead): Region[] {
  return [
    { key: 'supplier', field: read.supplier }, { key: 'billNumber', field: read.billNumber }, { key: 'date', field: read.date }, { key: 'total', field: read.total },
    ...read.lines.map((l, i) => ({ key: `line-${i}`, field: l.amount })), ...read.tax.map((t, i) => ({ key: `tax-${i}`, field: t.amount })),
  ];
}

function FieldRect({ r, active, height }: { r: Region; active: string | null; height: number }) {
  const g = r.field.region!;
  const tone = active === r.key ? b.regionActive : r.field.certainty === 'sure' ? b.region : b.regionAmber;
  if (g.box) return <rect data-region={r.key} data-box="words" x={g.box.x} y={g.box.y * height / 1000} width={g.box.w} height={g.box.h * height / 1000} className={tone} />;
  const h = height / g.of;
  return <rect data-region={r.key} data-box="line" x={10} y={(g.line - 1) * h} width={980} height={h} className={tone} />;
}

/** The overlay on page 1 (the person's own picture or PDF). viewBox 1000 by 1000, stretched to the page. */
export function FirstPageRegions({ read, active, label }: { read: BillRead; active: string | null; label: string }) {
  const regions = regionsOf(read).filter(r => r.field.region && r.field.region.page === 1 && r.field.region.of > 0);
  return (
    <svg className={b.regions} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={label}>
      {regions.map(r => <FieldRect key={r.key} r={r} active={active} height={1000} />)}
    </svg>
  );
}

/** One panel per page after the first, each with its words and its fields, in the page's own proportions. */
export function LaterPages({ read, active, language }: { read: BillRead; active: string | null; language: Language }) {
  const k = useR4bWords(language);
  const pages: Outline = read.outline ?? [];
  const later = pages.filter(p => p.page > 1 && p.width > 0 && p.height > 0);
  if (later.length === 0) return null;
  const regions = regionsOf(read);
  return (
    <div className={o.pages} data-later-pages>
      <p className={o.caption}>{k['bill.outlineNote']}</p>
      {later.map(p => {
        const height = Math.max(1, Math.round(1000 * p.height / p.width));
        const label = fill(k['bill.pageOf'], { n: p.page, of: read.reader.pages });
        return (
          <figure key={p.page} className={o.panel} data-page={p.page}>
            <svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={label}>
              {p.boxes.map((w, i) => <rect key={i} className={o.word} x={w.x} y={w.y * height / 1000} width={w.w} height={w.h * height / 1000} />)}
              {regions.filter(r => r.field.region && r.field.region.page === p.page && r.field.region.of > 0).map(r => <FieldRect key={r.key} r={r} active={active} height={height} />)}
            </svg>
            <figcaption className={o.caption}>{label}{p.omitted > 0 && <> · {fill(k['bill.omitted'], { n: p.omitted })}</>}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
