/**
 * Receipt: the proof behind a number, drawn like a till receipt. Six parts, top to bottom:
 *   1. How it was worked out: four marks on a line (question, calculation, rows read,
 *      total checked).
 *   2. The calculation, the period, and "As known on".
 *   3. Rows counted and rows left out, with the reason for each group left out.
 *   4. The total, with a rule above it.
 *   5. Small print under a dashed line, in the fixed order. A line the engine did not
 *      supply is not drawn; it is never filled in.
 *   6. Two links: open the rows, and export. Each is drawn only when its callback is given.
 * Lines appear top to bottom 30 ms apart and the last has finished by 400 ms (the
 * shared `m-appear` motion, whose tokens are 0 under reduced motion).
 * Formats nothing: every string arrives from the adapter (bridge/receipt-view.ts).
 */

import type { CSSProperties, ReactNode } from 'react';
import type { ReceiptSmallPrint, ReceiptView } from '../bridge/receipt-view.ts';
import { pluralSelector } from '../app/plural.ts';
import { useT } from '../app/text';
import { Button } from './Button';
import { Figure, MissingWords } from './Figure';
import { Label } from './Label';
import { Square } from './Square';
import s from './Receipt.module.css';

export interface ReceiptProps {
  receipt: ReceiptView;
  /** A total is a figure, and a figure opens its receipt. */
  onReceipt: (receiptId: string) => void;
  onOpenRows?: ((receiptId: string) => void) | undefined;
  onExport?: ((receiptId: string) => void) | undefined;
  className?: string | undefined;
}

type Line = { key: string; node: ReactNode };

function smallPrintLines(p: ReceiptSmallPrint, t: ReturnType<typeof useT>): Line[] {
  const lines: Line[] = [];
  const add = (key: string, name: string, value: string) => lines.push({ key, node: <><dt>{name}</dt><dd>{value}</dd></> });
  const parts = (...items: (string | undefined)[]) => items.filter((x): x is string => x !== undefined && x.length > 0).join(' · ');
  if (p.source) add('source', t('RECEIPT.small.source'), parts(p.source.names, p.source.wayIn && t(`RECEIPT.wayIn.${p.source.wayIn}`), p.source.readAt && t('RECEIPT.small.readAt', { when: p.source.readAt })));
  if (p.recipe) add('recipe', t('RECEIPT.small.recipe'), parts(p.recipe.recipeId, t(`RECEIPT.recipe.${p.recipe.state}`), t('RECEIPT.small.acceptedBy', { who: p.recipe.acceptedBy }), t(`RECEIPT.grade.${p.recipe.grade}`)));
  if (p.meaning) add('meaning', t('RECEIPT.small.meaning'), parts(
    p.meaning.version && t('RECEIPT.small.version', { version: p.meaning.version }),
    t('RECEIPT.small.publishedBy', { who: p.meaning.publishedBy }),
    p.meaning.reviewedBy && t('RECEIPT.small.reviewedBy', { who: p.meaning.reviewedBy }),
    p.meaning.cosignedBy && t('RECEIPT.small.cosignedBy', { who: p.meaning.cosignedBy }),
  ));
  if (p.rate) add('rate', t('RECEIPT.small.rate'), parts(p.rate.value, p.rate.date, p.rate.source));
  if (p.forecast) add('forecast', t('RECEIPT.small.forecast'), parts(p.forecast.method, t('RECEIPT.small.trainedOn', { months: p.forecast.trainedOn }), t('RECEIPT.small.heldOut', { months: p.forecast.heldOut })));
  if (p.numberGuard) add('guard', t('RECEIPT.small.guard'), t(p.numberGuard.passed ? 'RECEIPT.guard.passed' : 'RECEIPT.guard.failed', { matched: p.numberGuard.matched.display, of: p.numberGuard.of.display }));
  if (p.allowedBy) add('allowed', t('RECEIPT.small.allowedBy'), parts(p.allowedBy.text, p.allowedBy.ruleId, p.allowedBy.person, p.allowedBy.device, p.allowedBy.at));
  if (p.route) add('route', t('RECEIPT.small.route'), parts(p.route.kind, t(`RECEIPT.send.${p.route.sendLevel}`), p.route.cost && t('RECEIPT.small.cost', { cost: p.route.cost })));
  return lines;
}

export function Receipt({ receipt: r, onReceipt, onOpenRows, onExport, className }: ReceiptProps) {
  const t = useT();
  let order = 0;
  /* Each line takes the next place in the top-to-bottom appearance. */
  const appear = (...cls: (string | undefined)[]): { className: string; style: CSSProperties } => ({ className: [...cls, 'm-appear'].filter(Boolean).join(' '), style: { '--i': String(order++) } as CSSProperties });

  const marks: { key: string; done: boolean; words: string }[] = [
    { key: 'question', done: r.workedOut.question !== undefined, words: r.workedOut.question !== undefined ? t('RECEIPT.mark.question', { question: r.workedOut.question }) : t('RECEIPT.mark.noQuestion') },
    { key: 'calculation', done: true, words: t('RECEIPT.mark.calculation', { name: r.workedOut.calculation }) },
    { key: 'rows', done: true, words: t('RECEIPT.mark.rows', { rows: r.workedOut.rowsRead.display, form: pluralSelector(r.workedOut.rowsRead.exact) }) },
    { key: 'total', done: r.workedOut.totalChecked, words: t(r.workedOut.totalChecked ? 'RECEIPT.mark.checked' : 'RECEIPT.mark.notChecked') },
  ];
  const small = smallPrintLines(r.smallPrint, t);

  return (
    <article className={[s.receipt, className].filter(Boolean).join(' ')} aria-label={t('RECEIPT.title', { id: r.receiptId })} data-receipt-id={r.receiptId}>
      <ol aria-label={t('RECEIPT.workedOut')} {...appear(s.marks)}>
        {marks.map((m) => (
          <li key={m.key} className={s.mark} data-mark={m.key}>
            <Square mark={m.done ? 'cha' : 'off'} wordsKey={m.done ? 'RECEIPT.markDone' : 'RECEIPT.markOpen'} />
            <span className={s.markWords}>{m.words}</span>
          </li>
        ))}
      </ol>

      <dl className={s.lines}>
        <div {...appear(s.line)}>
          <dt>{t('RECEIPT.calculation')}</dt>
          <dd className="fig">{r.calculation}</dd>
        </div>
        <div {...appear(s.line)}>
          <dt>{t('RECEIPT.period')}</dt>
          <dd className="fig">{r.period ? t('RECEIPT.periodRange', { from: r.period.from, to: r.period.to }) : <MissingWords missing="not-applicable" />}</dd>
        </div>
        <div {...appear(s.line)}>
          <dt>{t('RECEIPT.asKnownOn')}</dt>
          <dd className="fig">{r.asKnownOn}</dd>
        </div>
      </dl>

      <dl className={s.lines}>
        <div {...appear(s.line)}>
          <dt>{t('RECEIPT.rowsCounted')}</dt>
          <dd className="fig">{r.rowsCounted.display}</dd>
        </div>
        {r.leftOut.length === 0 ? (
          <div {...appear(s.line)}>
            <dt>{t('RECEIPT.leftOut')}</dt>
            <dd className="fig">{t('RECEIPT.leftOutNone')}</dd>
          </div>
        ) : (
          r.leftOut.map((g, i) => (
            <div key={`${g.reason}-${i}`} {...appear(s.line, s.indent)} data-left-out="">
              <dt>{t('RECEIPT.leftOutReason', { reason: g.reason })}</dt>
              <dd className="fig">{g.rows.display}</dd>
            </div>
          ))
        )}
      </dl>

      <div {...appear(s.totals)}>
        {r.statement !== undefined && <Label kind={r.statement} />}
        {r.totals.length === 0 ? (
          <p className={s.total}>
            <span>{t('RECEIPT.total')}</span>
            <MissingWords missing="unknown" />
          </p>
        ) : (
          <dl className={s.totalList}>
            {r.totals.map((tot) => (
              <div key={tot.key} className={s.total}>
                <dt>{tot.label}</dt>
                <dd>
                  <Figure value={tot.figure} onReceipt={onReceipt} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <dl className={s.small} aria-label={t('RECEIPT.smallPrint')}>
        {small.map((line) => (
          <div key={line.key} data-small={line.key} {...appear(s.smallLine)}>
            {line.node}
          </div>
        ))}
        <div data-small="id" {...appear(s.smallLine)}>
          <dt>{t('RECEIPT.small.id')}</dt>
          <dd className="fig">{r.receiptId}</dd>
        </div>
      </dl>

      {(onOpenRows || onExport) && (
        <div {...appear(s.links)}>
          {onOpenRows && (
            <Button variant="link" onClick={() => onOpenRows(r.receiptId)}>
              {t('RECEIPT.openRows')}
            </Button>
          )}
          {onExport && (
            <Button variant="link" onClick={() => onExport(r.receiptId)}>
              {t('RECEIPT.export')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
