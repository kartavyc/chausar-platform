import { Fragment, type ReactNode } from 'react';
import { useT, type T } from '../text';
import { useClock } from '../shell/clock';
import type { QueueAmount, QueueRow, QueueSendsTo } from '../engine/types';
import { Count, Figure } from './Figure';
import { Icon } from './Icon';
import type { IconName } from './icons';
import s from './ApprovalMeta.module.css';

/**
 * W4 4J19: what the engine says about a Today row beyond its title and line (4J1's views/row-meta.ts, 4J16's quote
 * fixes): who it is for, the business, when it came in and when it expires, how long it waited, where approving it
 * sends something, which try this is and what went wrong last time, counts against a platform's limits, a plan's
 * change count, and the price beside Approve. Every field is drawn only when the engine sends it; nothing is worked out
 * here but the minutes or hours until a real expiry, read from the clock. Every amount is the engine's text at the
 * exact place it gives, inside a Figure with its receipt or the "model estimate" label.
 */

/** Where an amount sits in a row, as QueueAmount names it. */
type Where = QueueAmount['where'];

/** The amounts the engine proved in one field of the row, in order, each at its own place. */
function amountsIn(row: QueueRow, where: Where, index?: number): QueueAmount[] {
  return (row.amounts ?? [])
    .filter((amount) => amount.where === where && (index === undefined || amount.index === index))
    .sort((a, b) => a.start - b.start);
}

/** An amount anywhere in a text (the money rule's own test, tests/helpers/ink-rules.ts MONEY). */
const HOLDS_AMOUNT = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s?)\d/;

/**
 * A field's text with each amount the engine proved drawn as a Figure at its exact offsets. `proved` is true when every
 * amount-looking piece of the text sits in a figure, so the caller can drop the `data-engine-line` stopgap; an amount
 * the engine left unproved keeps it (NOTES item 30: some lines are still unproved on the engine).
 */
export function provedText(row: QueueRow, text: string, where: Where, onReceipt?: (id: string) => void, index?: number): { node: ReactNode; proved: boolean; any: boolean } {
  const amounts = amountsIn(row, where, index).filter((amount) => text.slice(amount.start, amount.start + amount.length) === amount.text);
  if (amounts.length === 0) return { node: text, proved: !HOLDS_AMOUNT.test(text), any: false };
  const parts: ReactNode[] = [];
  let at = 0;
  let loose = '';
  amounts.forEach((amount, i) => {
    if (amount.start < at) return;
    const before = text.slice(at, amount.start);
    loose += before;
    parts.push(<Fragment key={`t${i}`}>{before}</Fragment>);
    parts.push(amount.estimate
      ? <Figure key={`f${i}`} value={amount.text} estimate />
      : <Figure key={`f${i}`} value={amount.text} receiptId={amount.receiptId} onReceipt={onReceipt} />);
    at = amount.start + amount.length;
  });
  const rest = text.slice(at);
  loose += rest;
  parts.push(<Fragment key="rest">{rest}</Fragment>);
  return { node: parts, proved: !HOLDS_AMOUNT.test(loose), any: true };
}

/** The proof the engine gave a change's new value, when the change itself carries none (a plan's change count). */
export function changeProof(row: QueueRow): { receiptId: string } | { estimate: true } | null {
  const amount = amountsIn(row, 'change.after')[0];
  if (!amount) return null;
  return amount.estimate ? { estimate: true } : { receiptId: amount.receiptId };
}

const MINUTE = 60_000;

/** "expires in 40 min", "expires in 2 h", or "expired": from the engine's real expiry and the clock, nothing else. */
export function expiryWords(expiresAt: string, now: Date, t: T): string | null {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  const left = at - now.getTime();
  if (left <= 0) return t('approval.meta.expired');
  const minutes = Math.ceil(left / MINUTE);
  if (minutes < 60) return t('approval.meta.expiresMin', { count: String(minutes) });
  const hours = Math.round(minutes / 60);
  return hours < 48 ? t('approval.meta.expiresHours', { count: String(hours) }) : t('approval.meta.expiresDays', { count: String(Math.round(hours / 24)) });
}

/**
 * The card's meta line (D's `.qc-meta`): "for Mehta Traders · Ledgerline · 09:20 · expires in 2 h", then how long it
 * has waited in the engine's words ("Waiting since yesterday"). The business shows only when Today lists more than one.
 */
export function MetaLine({ row, showBusiness, time }: { row: QueueRow; showBusiness: boolean; time: string }) {
  const t = useT();
  const now = useClock();
  const meta = row.meta;
  const expires = meta?.expiresAt ? expiryWords(meta.expiresAt, now(), t) : null;
  const pieces: ReactNode[] = [];
  if (meta?.client && !namesClient(row, meta.client)) pieces.push(<span key="client" data-meta-client="">{t('approval.meta.for', { client: meta.client })}</span>);
  if (showBusiness) pieces.push(<span key="business">{meta?.business ?? row.businessName}</span>);
  if (time) pieces.push(<span key="time" className="mono">{time}</span>);
  if (expires) pieces.push(<span key="expires" className={s.expires} data-meta-expires="">{expires}</span>);
  if (meta?.waitingLong) pieces.push(<span key="waiting" className={s.waiting} data-meta-waiting="">{meta.waitingLong}</span>);
  return <>{pieces.map((piece, index) => <Fragment key={index}>{index > 0 && ' · '}{piece}</Fragment>)}</>;
}

/** The card already names the client: in its title, or on the paper its preview shows (4J19 review: no repeats). */
function namesClient(row: QueueRow, client: string): boolean {
  if (row.title.includes(client)) return true;
  const preview = row.preview;
  if (preview?.kind !== 'paper') return false;
  return preview.paper === 'invoice' ? preview.to === client : preview.client === client;
}

const SENDS_ICON: Record<QueueSendsTo, IconName> = { client: 'send', public: 'megaphone', bank: 'wallet', portal: 'stamp' };

/**
 * The facts under a row's line: where approving it sends something, which try this is and what went wrong last time,
 * counts against the platform's limits, a plan's change count with its details folded and what the comparison does not
 * cover, and a draft that has waited too long. Nothing when the engine sent none of them.
 */
export function RowFacts({ row, onReceipt }: { row: QueueRow; onReceipt?: ((id: string) => void) | undefined }) {
  const t = useT();
  const { sendsTo, attempt, changeCount } = row;
  // 4Z2: a count against a platform's limit shows only near the limit (nine tenths of it or more); far under it, it
  // was a number to puzzle over. Over the limit it always shows.
  const counts = row.counts?.filter((count) => count.count * 10 >= count.limit * 9);
  const stale = row.meta?.staleDraft;
  if (!sendsTo && !attempt && !counts?.length && !changeCount && !stale) return null;
  return (
    <div className={s.facts} data-facts="">
      {(sendsTo || attempt || counts?.length) ? (
        <p className={s.chips}>
          {sendsTo && (
            <span className={s.sends} data-sends-to={sendsTo}>
              <Icon name={SENDS_ICON[sendsTo] ?? 'send'} size={12} />
              {t(`approval.meta.sendsTo.${sendsTo}`)}
            </span>
          )}
          {counts?.map((count) => (
            <span key={count.label} className={s.count} data-count-of="" data-over={count.count > count.limit ? '' : undefined}>
              {count.label}{' '}
              <Count value={count.count.toLocaleString('en-IN')} />
              {' '}{t('approval.meta.of')}{' '}
              <Count value={count.limit.toLocaleString('en-IN')} />
              {/* Over the platform's limit: the words and a mark say so, not the colour alone. */}
              {count.count > count.limit && <> · <Icon name="triangle-alert" size={12} />{t('approval.meta.over')}</>}
            </span>
          ))}
        </p>
      ) : null}
      {attempt && (
        <p className={s.attempt} data-attempt="">
          {attempt.lastError ? t('approval.meta.attemptError', { n: String(attempt.n), error: attempt.lastError }) : t('approval.meta.attempt', { n: String(attempt.n) })}
        </p>
      )}
      {changeCount && (
        <details className={s.changes} data-change-count="">
          <summary>{changeCount.line}</summary>
          {changeCount.details.length > 0 && (
            <ul className={s.details}>
              {changeCount.details.map((detail, index) => {
                const shown = provedText(row, detail, 'details', onReceipt, index);
                return <li key={index} data-engine-line={shown.proved ? undefined : ''}>{shown.node}</li>;
              })}
            </ul>
          )}
          <p className={s.coverage} data-coverage="">{changeCount.coverage}</p>
        </details>
      )}
      {stale && <p className={s.stale} data-stale-draft="">{stale}</p>}
    </div>
  );
}

/**
 * Beside Approve: the price, as the engine formatted it, with its receipt and the engine's line ("₹4.20, Nothing spent
 * yet"), the free way when there is one, and the quotes code moved on this draft (4J16, Q4) so the owner reads them
 * before approving.
 */
export function BesideApprove({ row, onReceipt }: { row: QueueRow; onReceipt?: ((id: string) => void) | undefined }) {
  const t = useT();
  const { price } = row;
  const fixes = row.meta?.quoteFixes ?? [];
  if (!price && fixes.length === 0) return null;
  return (
    <div className={s.beside} data-beside="">
      {price && (
        <p className={s.price} data-price="">
          <Figure value={price.display} receiptId={price.receiptId} onReceipt={onReceipt} />
          <span className={s.priceLine}>{price.line}</span>
        </p>
      )}
      {price?.free && <p className={s.free} data-free="">{price.free}</p>}
      {fixes.length > 0 && (
        <div className={s.fixes} data-quote-fixes="">
          <p className={s.fixesHead}>{t('approval.meta.quoteFixes')}</p>
          <ul className={s.details}>{fixes.map((fix, index) => <li key={index}>{fix}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
