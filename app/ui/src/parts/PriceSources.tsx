import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../text';
import type { PriceGuideView, PriceRangeView } from '../engine/types';
import { cx } from './cx';
import s from './PriceSources.module.css';

/**
 * W6 6C3 (D17): where a price range comes from. The (i) button opens a small popover beside the range, as in
 * reference-ui/OnboardB.dc.html: the sources (publisher and title, each a link that opens apart from Chausar), the date
 * checked and "Your price is yours to set." With no credible source it says "No reliable data" and why. Every amount
 * and date is the engine's words (core/price-ranges.ts); nothing here computes money or touches a price. Built from
 * phrasing elements only, so it sits inside a line of text (a `<p>`) as well as on its own. describedBy: the id of the
 * range's own label, so each of several (i) buttons is told apart by what it explains.
 */
export function PriceSources({ guide, range, describedBy }: { guide: PriceGuideView; range?: PriceRangeView | undefined; describedBy?: string | undefined }) {
  const t = useT();
  const popId = useId();
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sourced = range !== undefined;
  const close = () => { setOpen(false); button.current?.focus(); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  return (
    <span className={s.wrap} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className={s.info}
        aria-label={sourced ? t('price-sources.where') : t('price-sources.whyNone')}
        aria-expanded={open}
        aria-controls={popId}
        aria-describedby={describedBy}
        data-price-sources=""
        onClick={() => setOpen((was) => !was)}
      />
      <span id={popId} className={s.pop} role="group" aria-labelledby={titleId} hidden={!open}>
        {open && (
          <>
            <span id={titleId} className={s.title}>{sourced ? t('price-sources.where') : guide.line}</span>
            {sourced && <span>{range.label}</span>}
            {sourced ? (
              <span role="list" className={s.list}>
                {range.sources.map((source) => (
                  <span role="listitem" key={source.url + source.title} className={s.item}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher}: {source.title}</a>
                  </span>
                ))}
              </span>
            ) : null}
            <span className={s.meta}>{sourced ? range.note : guide.reason}</span>
            <span className={s.meta}>{t('price-sources.checked', { date: sourced ? range.checked : guide.checked })}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** One sourced range as a line: its words, its unit and city, and its (i). The line is proved by its sources. */
export function PriceRange({ guide, range, className }: { guide: PriceGuideView; range: PriceRangeView; className?: string | undefined }) {
  const t = useT();
  const labelId = useId();
  return (
    <span className={cx(s.line, className)} data-sourced-range="">
      <span id={labelId} className={s.label}>{range.label}</span>
      <span className={cx(s.amount, 'mono')}>{range.text}</span>
      <span className={s.per}>{range.city ? t('price-sources.perIn', { per: range.per, city: range.city }) : range.per}</span>
      <PriceSources guide={guide} range={range} describedBy={labelId} />
    </span>
  );
}

/** A profession's guide: each sourced range on its own line, or "No reliable data" with why. Never a price field. */
export function PriceGuideList({ guide, className }: { guide: PriceGuideView; className?: string | undefined }) {
  if (guide.status !== 'sourced') {
    return (
      <p className={cx(s.none, className)} data-price-guide="none">
        <span>{guide.line}</span>
        <PriceSources guide={guide} />
      </p>
    );
  }
  return (
    <ul className={cx(s.guide, className)} data-price-guide="sourced">
      {guide.ranges.map((range) => <li key={range.id}><PriceRange guide={guide} range={range} /></li>)}
    </ul>
  );
}
