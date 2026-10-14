/**
 * FR-09 The first answer. One suggested question from the published menu of calculations
 * (`ontology.get`: the current dictionary's operations). Asking runs the registered
 * calculation in the engine (`calculation.run`); the answer is drawn only from its receipt,
 * read back with `receipts.get` and checked before drawing, and the receipt is shown open.
 * No model is involved and nothing is added up here.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { count } from '../../format/counts.ts';
import { money } from '../../format/money.ts';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import type { CalculationReceiptEvidence } from '../../bridge/presentation.ts';
import { ReplyValidationError, projectCalculationReceipt } from '../../bridge/validate.ts';
import { validateOntologyReadback, type Operation } from './contracts.ts';
import { failureOf, validateCalculationId, type JourneyFailure, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

/** The suggested operation: billed when the menu has it, else the first single sum. */
export function suggestedOperation(operations: readonly Operation[]): Operation | null {
  const sums = operations.filter(operation => operation.type === 'sum' && operation.definitions.length === 1);
  return sums.find(operation => operation.id === 'billed') ?? sums[0] ?? null;
}

type Menu = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly operation: Operation | null } | { readonly kind: 'failed'; readonly failure: JourneyFailure };
type Answer = { readonly kind: 'none' } | { readonly kind: 'working' } | { readonly kind: 'ready'; readonly receipt: CalculationReceiptEvidence } | { readonly kind: 'failed'; readonly failure: JourneyFailure };

export interface FirstAnswerProps {
  readonly rpc: JourneyPort;
  /** Seconds from the first screen to this receipt, once answered. */
  readonly elapsed: number | null;
  readonly onAnswered: () => void;
  readonly onOpenReceipt?: ((id: string) => void) | undefined;
  readonly onToday: () => void;
}

export function FirstAnswer({ rpc, elapsed, onAnswered, onOpenReceipt, onToday }: FirstAnswerProps) {
  const t = useT();
  const [menu, setMenu] = useState<Menu>({ kind: 'reading' });
  const [answer, setAnswer] = useState<Answer>({ kind: 'none' });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void (async () => {
      try {
        const readback = validateOntologyReadback(await rpc.request('ontology.get', {}));
        if (live.current) setMenu({ kind: 'ready', operation: readback.current === null ? null : suggestedOperation(readback.current.operations) });
      } catch (error) { if (live.current) setMenu({ kind: 'failed', failure: failureOf(error) }); }
    })();
    return () => { live.current = false; };
  }, [rpc]);

  const ask = async (operation: Operation) => {
    setAnswer({ kind: 'working' });
    try {
      const id = validateCalculationId(await rpc.request('calculation.run', { operation: operation.id }));
      const receipt = projectCalculationReceipt(await rpc.request('receipts.get', { id }));
      if (receipt.id !== id || receipt.operation !== operation.id) throw new ReplyValidationError('receipt.id');
      if (!live.current) return;
      setAnswer({ kind: 'ready', receipt });
      onAnswered();
    } catch (error) { if (live.current) setAnswer({ kind: 'failed', failure: failureOf(error) }); }
  };

  const valueOf = (receipt: CalculationReceiptEvidence): string => receipt.currency === 'INR'
    ? money(receipt.valueMinor)
    : receipt.figures.find(figure => figure.key === receipt.operation)?.display ?? `${receipt.currency} ${receipt.valueMinor}`;

  const pairs = (receipt: CalculationReceiptEvidence, label: string): Pair[] => [
    { name: t('FR-09.receipt.operation'), value: label },
    { name: t('FR-09.receipt.period'), value: receipt.period === null ? t('FR-09.receipt.allTime') : t('FR-09.receipt.range', { from: receipt.period.from, to: receipt.period.to }) },
    { name: t('FR-09.receipt.rows'), value: count(String(receipt.coverage.countedRows)), mono: true },
    { name: t('FR-09.receipt.excluded'), value: count(String(receipt.coverage.excludedRows)), mono: true },
    { name: t('FR-09.receipt.sources'), value: receipt.sourceIds.join(', ') },
    { name: t('FR-09.receipt.coverage'), value: t(`FR-09.coverage.${receipt.coverage.completeness}`) },
    { name: t('FR-09.receipt.version'), value: String(receipt.ontologyVersion), mono: true },
  ];

  return (
    <section data-first-run-screen="answer">
      <StepHeader step={6} title="FR-09.title" lede="FR-09.lede" />
      {menu.kind === 'reading' && <Status k="FR-03.reading" />}
      {menu.kind === 'failed' && <FailureLine failure={menu.failure} notBuilt="FR-09.notBuilt" refused="FR-09.refused" />}
      {menu.kind === 'ready' && menu.operation === null && <Note k="FR-09.noMenu" role="status" />}
      {menu.kind === 'ready' && menu.operation !== null && (() => {
        const operation = menu.operation;
        return (
          <>
            <p className={s.question} data-suggested-question={operation.id}>{t('FR-09.question', { label: operation.label })}</p>
            {answer.kind !== 'ready' && (
              <Actions><Act variant="filled" label="FR-09.ask.btn" disabled={answer.kind === 'working'} onClick={() => { void ask(operation); }} /></Actions>
            )}
            {answer.kind === 'working' && <Status k="FR-09.working" />}
            {answer.kind === 'failed' && <FailureLine failure={answer.failure} notBuilt="FR-09.notBuilt" refused="FR-09.refused" />}
            {answer.kind === 'ready' && (
              <>
                <p className={[s.answer, 'fig'].join(' ')} data-first-answer="">{t('FR-09.answer', { label: operation.label, value: valueOf(answer.receipt) })}</p>
                <section className={s.section} data-receipt-open={answer.receipt.id} aria-label={t('FR-09.receipt')}>
                  <h2 className={s.sectionTitle}>{t('FR-09.receipt')}</h2>
                  <KeyValue pairs={pairs(answer.receipt, operation.label)} onReceipt={id => onOpenReceipt?.(id)} />
                  {answer.receipt.stale && <Note k="FR-09.receipt.stale" />}
                </section>
                {elapsed !== null && <Note k="FR-09.elapsed" values={{ minutes: String(Math.floor(elapsed / 60)), seconds: String(elapsed % 60) }} />}
                <Actions>
                  {onOpenReceipt !== undefined && <Act label="FR-09.open.btn" onClick={() => onOpenReceipt(answer.receipt.id)} />}
                  <Act variant="filled" label="FR.journey.today.btn" onClick={onToday} />
                </Actions>
              </>
            )}
          </>
        );
      })()}
    </section>
  );
}
