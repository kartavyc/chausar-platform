import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { ApprovalRow } from '../../parts/ApprovalRow';
import { decide as decideRow, reread as rereadRow, useTodaySession } from '../today/session';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Tile, TileHead } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import type { BlueprintViewLite, EngineClient, LabelledLite, QueueDecision, QueueRow } from '../../engine/types';
import { formatDay } from '../../../../../platform/runtime/owner-format';
import s from './Business.module.css';

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A day (2026-10-21) or a moment as the owner reads the date, "21 Oct 2026". A moment reads in the owner's zone
 * (`useOwnerZone`), so a drill run at 00:50 in India on 3 Nov is a 3 Nov drill (one-shot B2, row 37); a calendar day
 * never shifts. Dates only; no figure is formatted here.
 */
export function dayOf(at: string, zone: string): string {
  return formatDay(at, zone);
}

/**
 * One section of a business page: a region named by its heading, and its words under it spaced by the grid. Plain
 * (B4 task 1): no box; a section after another is parted by one hairline rule. Every business page is built from these.
 */
export function TileSection({ title, meta, end, more, className, children }: {
  title: string; meta?: ReactNode; end?: ReactNode; more?: { href: string; label: string } | undefined;
  className?: string | undefined; children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <Tile as="section" plain labelledBy={headingId} className={cx(s.section, className)}>
      <TileHead id={headingId} title={title} meta={meta} end={end} more={more} />
      <div className={s.body}>{children}</div>
    </Tile>
  );
}

/**
 * Who said a line, in small grey words; a number a model wrote says "model estimate".
 * accepted: the line is part of a plan the owner accepted. Words Chausar assumed are then no assumption any more (the
 * owner read the plan and accepted it), so that word is not said beside them; every other label still is.
 */
export function LabelTag({ line, accepted = false }: { line: Pick<LabelledLite<unknown>, 'label' | 'estimate'>; accepted?: boolean }) {
  const t = useT();
  return (
    <>
      {!(accepted && line.label === 'assumption') && <span className={s.tag}>{t(`business.label.${line.label}`)}</span>}
      {line.estimate && <> <ModelEstimate /></>}
    </>
  );
}

/** Set by Read on a page that does not show the plan: the plan page takes focus to the plan's name once it is there. */
let planFocusAsked = false;
/** Whether Read asked for the plan's name to take focus; asking is used up by the answer. */
export function takePlanFocus(): boolean {
  const asked = planFocusAsked;
  planFocusAsked = false;
  return asked;
}
/**
 * Read on a plan row: focus goes to the plan's name where the plan is on this page; from any other settings page
 * (Prices) the owner is taken to the plan itself, which then takes focus (seen on Windows, 15 Nov 2026: Read did
 * nothing on Prices).
 */
function readPlan(): void {
  const name = document.getElementById('business-plan-name');
  if (name) { name.focus(); return; }
  planFocusAsked = true;
  window.location.hash = '#/business/plan';
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

const onQueue = (event: { type: string }) => event.type === 'queue.changed';

/**
 * The plan and price rows waiting on Today for this business, decided here through the same queue and Today's session
 * (one-shot B3): the owner is reading the plan on this page, so it counts as viewed. One price and nothing else is one
 * press with an Undo (B4); anything more still asks twice.
 * The rows are the live plan rows, the ones whose decision is on its way, and the ones the session holds as decided,
 * so a row being decided never leaves the list (its card keeps its key from press to answer and shows its own line),
 * and a row already decided is drawn as its line, never as a fresh card. Lines stay for the session, as on Today.
 */
export function PendingPlanRows({ onDecided }: { onDecided: () => void }) {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const queue = useResource('venture.queue.list', { scope: 'current' }, { refreshOn: onQueue });
  // Every business's rows, for the locked ones: a line of a business that is no longer open is not this page's.
  const all = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: onQueue });
  const plan = (row: QueueRow) => row.viewRef?.kind === 'plan';
  const live = (queue.data?.rows ?? []).filter(plan);
  const liveIds = new Set(live.map((row) => row.id));
  const locked = new Set((all.data?.rows ?? []).filter((row) => row.kind === 'locked').map((row) => row.businessId));
  const ours = (row: QueueRow) => plan(row) && !liveIds.has(row.id) && !locked.has(row.businessId);
  const held = session.heldRows().filter(ours);
  const heldIds = new Set(held.map((row) => row.id));
  const decided = session.lines().filter((line) => ours(line.row) && !heldIds.has(line.row.id));
  // The same words for an earlier version and a later one ("Plan accepted." twice) are one line: the newest. A line
  // that still carries an Undo stays, since each Undo takes back its own decision.
  const kept = decided.filter((line, at) => line.undo || !decided.slice(at + 1).some((later) => later.line === line.line)).map((line) => line.row);
  const rows = [...live, ...held, ...kept];
  function after(decision: QueueDecision): QueueDecision {
    if (decision.outcome === 'done') onDecided();
    return decision;
  }
  if (rows.length === 0) return null;
  return (
    <TileSection title={t('business.waiting')}>
      <ul className={s.list}>
        {rows.map((row) => (
          <ApprovalRow
            key={row.id}
            row={row}
            done={session.line(row.id)}
            said={session.said(row.id)}
            showBusiness={false}
            viewed
            onView={readPlan}
            onDecide={async (r, action, extra) => after(await decideRow(client, r, action.id, extra, t))}
            onReread={async (r) => after(await rereadRow(client, r, 'current', t))}
          />
        ))}
      </ul>
    </TileSection>
  );
}
