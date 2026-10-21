import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { ApprovalRow } from '../../parts/ApprovalRow';
import { ModelEstimate } from '../../parts/ModelEstimate';
import type { BlueprintViewLite, EngineClient, LabelledLite, QueueRow } from '../../engine/types';
import s from './Business.module.css';

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Who said a line, in small grey words; a number a model wrote says "model estimate". */
export function LabelTag({ line }: { line: Pick<LabelledLite<unknown>, 'label' | 'estimate'> }) {
  const t = useT();
  return (
    <>
      <span className={s.tag}>{t(`business.label.${line.label}`)}</span>
      {line.estimate && <> <ModelEstimate /></>}
    </>
  );
}

/**
 * A new plan version has no receipts of its own: price every priced offer again, as the engine's own screens do.
 * The calculator writes each receipt; nothing is worked out here.
 */
export async function quoteAgain(client: EngineClient): Promise<void> {
  const fresh = await client.request('venture.blueprint.get', {});
  for (const offer of fresh?.blueprint.offers ?? []) {
    if (offer.pricing.unitPriceMinor !== null && !fresh?.offerReceipts[offer.id]) await client.request('venture.price.quote', { offerId: offer.id });
  }
}

export function usePlan() {
  return useResource('venture.blueprint.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
}

/** The receipt's total as the engine wrote it, else its last figure. */
export function totalOf(receipt: BlueprintViewLite['offerReceipts'][string]): string | null {
  if (!receipt) return null;
  return (receipt.figures.find((f) => f.key === 'total') ?? receipt.figures.at(-1))?.display ?? null;
}

/**
 * The plan and price rows waiting on Today for this business, decided here through the same queue: the owner is
 * reading the plan on this page, so it counts as viewed. A price change still asks twice. Decided rows stay as their
 * receipt line until the page closes.
 */
export function PendingPlanRows({ onDecided }: { onDecided: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const queue = useResource('venture.queue.list', { scope: 'current' }, { refreshOn: (event) => event.type === 'queue.changed' });
  const [kept, setKept] = useState<QueueRow[]>([]);
  const live = (queue.data?.rows ?? []).filter((row) => row.viewRef?.kind === 'plan');
  const rows = [...live, ...kept.filter((k) => !live.some((r) => r.id === k.id))];
  if (rows.length === 0) return null;
  return (
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('business.waiting')}</h2>
      <ul className={s.list}>
        {rows.map((row) => (
          <ApprovalRow
            key={row.id}
            row={row}
            viewed
            onView={() => document.getElementById('business-plan-name')?.focus()}
            onDecide={async (r, action, extra) => {
              const decision = await client.request('venture.queue.decide', { id: r.id, digest: r.digest, action: action.id, ...extra });
              if (decision.outcome === 'done' || decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') setKept((k) => [...k, r]);
              if (decision.outcome === 'done') onDecided();
              return decision;
            }}
          />
        ))}
      </ul>
    </section>
  );
}
