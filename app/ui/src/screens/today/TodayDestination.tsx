/** One current scoped list or genuine resolved record, inside the existing single sheet. */
import type { TodayReviewQueue, TodayReviewRow, TodayJson } from '../../bridge/today-engine.ts';
import type { TodayDetail } from '../../bridge/today-navigation.ts';
import type { SheetProps } from '../../parts/Sheet';
import { Sheet } from '../../parts/Sheet';
import { Button } from '../../parts/Button';
import { Square } from '../../parts/Square';
import { useT } from '../../app/text';
import { MissingWords } from '../../parts/Figure';
import { Receipt } from '../../parts/Receipt';
import { receiptViewFromEvidence } from '../../bridge/receipt-view.ts';
import { useLanguage } from '../../app/text';
import { useRef } from 'react';

export interface TodayDestinationProps {
  readonly detail: TodayDetail | null;
  readonly page: TodayReviewQueue | null;
  readonly origin: HTMLElement | SVGElement | null;
  readonly onClose: () => void;
  readonly onReview: (row: TodayReviewRow, origin: HTMLElement | null) => void;
  readonly onNext: (() => void) | undefined;
  readonly onFresh: () => void;
  readonly onReceipt: (id: string, origin: HTMLElement | null) => void;
  readonly back?: SheetProps['back'];
  /** The workspace time zone; the six-part receipt is drawn only when it is known. */
  readonly timeZone?: string | null | undefined;
}
/** Producer data remain text. Structured evidence is disclosed field by field without HTML. */
function RecordedValue({ value }: { value: TodayJson }) {
  if (value === null) return <MissingWords missing="unknown" />;
  if (typeof value !== 'object') return <span className={typeof value === 'string' && /^-?\d/.test(value) ? 'fig' : undefined}>{String(value)}</span>;
  if (Array.isArray(value)) return <ol>{value.map((item, index) => <li key={index}><RecordedValue value={item} /></li>)}</ol>;
  return <dl>{Object.entries(value).map(([name, field]) => <div key={name}><dt>{name}</dt><dd><RecordedValue value={field} /></dd></div>)}</dl>;
}
export function TodayDestination({ detail, page, origin, onClose, onReview, onNext, onFresh, onReceipt, back, timeZone = null }: TodayDestinationProps) {
  const t = useT();
  const language = useLanguage();
  const every = useRef<HTMLDetailsElement>(null);
  let view = null;
  if (detail?.receipt !== undefined && timeZone !== null) {
    try { view = receiptViewFromEvidence(detail.receipt, { language, timeZone }); } catch { view = null; }
  }
  /* A figure on the receipt opens its every field: the exact values below. */
  const openEvery = () => { const element = every.current; if (element) { element.open = true; element.querySelector('summary')?.focus(); } };
  return <Sheet kind={t(detail === null ? 'TODAY_ENGINE.scope' : 'TODAY_ENGINE.detail')} title={detail?.kind === 'activity' ? t('TODAY_ENGINE.activity') : detail?.title ?? t('TODAY_ENGINE.scope')} origin={origin} onClose={onClose} back={back}>
    {detail === null && page !== null ? <>
      <p>{t(`TODAY_ENGINE.scope.${page.completeness}`)}</p>
      <p>{t('TODAY_ENGINE.known', { count: String(page.knownCount) })}</p>
      <ol>{page.rows.map(row => <li key={JSON.stringify(row.reference)}><Square mark="you" /> <Button variant="link" onClick={event => onReview(row, event.currentTarget)}>{row.title}</Button></li>)}</ol>
      {onNext && <Button variant="quiet" onClick={onNext}>{t('TODAY_ENGINE.next')}</Button>}
      <Button variant="link" onClick={onFresh}>{t('TODAY_ENGINE.readAgain')}</Button>
    </> : detail !== null ? <>
      {detail.kind === 'activity' && <p>{t('TODAY_ENGINE.activityPartial')}</p>}
      {view !== null && <Receipt receipt={view} onReceipt={openEvery} />}
      <details ref={every} open={view === null}><summary>{t('TODAY_ENGINE.every')}</summary>
      <p>{t('TODAY_ENGINE.sourceWords')}</p>
      {detail.receiptIds.map(id => <p key={id}><Button variant="link" aria-label={t('TODAY_ENGINE.proof', { id })} onClick={event => onReceipt(id, event.currentTarget)}>{t('TODAY_ENGINE.proofShort')}</Button> <span>{id}</span></p>)}
      <RecordedValue value={detail.record} />
      </details>
    </> : <p>{t('TODAY_ENGINE.unavailable')}</p>}
  </Sheet>;
}
