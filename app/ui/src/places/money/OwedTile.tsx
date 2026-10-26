/**
 * Who owes you (D-Money `.owe`, `.ow-*`, `.ag-l`): what clients owe, as the engine's figure with its receipt; how many
 * invoices are open (a Count); and either the five ages of what is owed (W4 4J4 venture.money.aging: the AgingBar, its
 * legend with counts and amounts, all under the one aging receipt) or, from an engine without aging, each open invoice,
 * oldest due first, with its client, number, due date and balance.
 *
 * The owed receipt is the engine's sum of exactly these open balances, so it proves the balances listed under it (one
 * `data-figure-group`). Without that receipt no amount is shown here, only the invoices, each a step from its own
 * figures in the invoice sheet.
 *
 * Reminders (W4 4J5, M12): the Billing agent drafts a payment reminder for each late invoice whose reminder day has come
 * (venture.invoice.remind); the owner sends each from their own app, through the draft sheet (4E4's OutreachSheet).
 * "Draft 3 reminders" drafts them; nothing is sent. Reminders already drafted open from here.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { AgingBar } from '../../parts/charts/AgingBar';
import type { AgingData } from '../../parts/charts/types';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { AgingView, InvoiceLite, MoneyOverviewLine } from '../../engine/types';
import { keepDraft } from '../clients/handoff';
import { Counted, InvoiceRef, lineProof } from './parts';
import { messageOf, onMoney, useDay, type OpenInvoice } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

export interface OwedTileProps {
  line: MoneyOverviewLine | undefined;
  /** The open invoices, oldest due first; undefined until the books answer. */
  open: OpenInvoice[] | undefined;
  aging?: AgingData | undefined;
  /** The engine's aging view as sent (4J4): its total and its open invoices with how late each is. */
  agingView?: AgingView | undefined;
  span: TileSpan;
}

export function OwedTile({ line, open, aging, agingView, span }: OwedTileProps) {
  const t = useT();
  const id = useId();
  const proof = lineProof(line);
  // With the aging view, its total is the figure (the same sum, under the aging receipt the chart is proved by).
  const aged = aging && agingView ? agingView : undefined;
  // Balances are shown only under the receipt that sums them; a model-written figure proves nothing under it.
  const receipted = proof !== null && proof.receiptId !== undefined;
  const figure = aged
    ? <Figure value={aged.total.display} receiptId={aged.total.receiptId} size="stat" className={s.owedFigure} />
    : line && proof && <Figure {...proof} value={line.value} size="stat" className={s.owedFigure} />;
  const list = open && open.length > 0 && !aged && <OpenList items={open} balances={receipted} />;
  const count = aged ? aged.invoices.length : open?.length;
  const late = aged ? aged.invoices.filter((invoice) => invoice.late !== null).length : 0;

  return (
    <Tile as="section" labelledBy={id} span={span} className={`${s.owed} ${v.fit}`}>
      <TileHead id={id} title={t('money.owed.title')} meta={count !== undefined ? <Counted text={t('money.owed.count', { count: String(count) })} count={count} /> : undefined} />
      <div className={s.owedBody} data-figure-group={receipted && list ? '' : undefined}>
        {figure}
        {/* 4J20: what the late ones owe, with its own receipt; from an engine without it, how many are late. */}
        {aged?.late
          ? <span className={v.lateWords} data-late-figure=""><Figure value={aged.late.display} receiptId={aged.late.receiptId} />{t('money.owed.lateOf')}</span>
          : late > 0 && <span className={v.lateWords}><Counted text={t('money.owed.late', { count: String(late) })} count={late} /></span>}
        {list}
      </div>
      {/* The five ages at rest as the bar, a visual cue with almost no words; each age in words, with its count and
          amount, is one step away in the chart's own table. Nothing owed draws no bar at all. */}
      {aging && count !== 0 && <div className={s.tileChart}><AgingBar data={aging} legend="held" /></div>}
      {count === 0 && <p className={s.quietLine}>{t('money.owed.none')}</p>}
      {aged && aged.invoices.length > 0 && <Reminders aging={aged} />}
    </Tile>
  );
}

/**
 * The reminders line at the foot of the tile (D's `.ow-f`): "Billing drafts, you send" and one button that drafts a
 * reminder for each late invoice whose reminder is due (its next step is 'remind' with no draft yet), then lists the
 * drafts to open and send. Each draft is the engine's; this only asks for it and opens it.
 */
function Reminders({ aging }: { aging: AgingView }) {
  const t = useT();
  const engine = useEngine();
  const list = useResource('venture.invoice.list', {}, { refreshOn: onMoney });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const owed = new Map(aging.invoices.map((invoice) => [invoice.invoiceId, invoice]));
  const rows = (list.data ?? []).filter((invoice) => owed.has(invoice.id) && invoice.next?.action === 'remind');
  const due = rows.filter((invoice) => !invoice.next?.draftId);
  const drafted = rows.filter((invoice) => invoice.next?.draftId);
  if (rows.length === 0) return null;

  async function draftAll(origin: HTMLElement) {
    setBusy(true);
    setProblems([]);
    const failed: string[] = [];
    let first: string | null = null;
    // One at a time, so each draft is the engine's answer for that invoice as it stands.
    for (const invoice of due) {
      try {
        const made = await engine.request('venture.invoice.remind', { invoiceId: invoice.id });
        keepDraft(engine, made.draft);
        first ??= made.draft.id;
      } catch (error) {
        failed.push(t('money.remind.failed', { number: invoice.number ?? '', message: messageOf(error) }));
      }
    }
    setProblems(failed);
    setBusy(false);
    list.reload();
    if (first && due.length === 1) openSheet('outreach', first, origin);
  }

  return (
    <div className={v.remind}>
      <p className={v.remindWho}>
        <Icon name="file-pen" size={14} />
        <span>{t('money.remind.who')}</span>
      </p>
      {due.length > 0 && (
        <Button size="sm" disabled={busy} onClick={(event) => void draftAll(event.currentTarget)}>
          {t('money.remind.draft', { count: String(due.length) })}
        </Button>
      )}
      {drafted.length > 0 && (
        <ul className={v.drafts} aria-label={t('money.remind.drafted')}>
          {drafted.map((invoice) => <Drafted key={invoice.id} invoice={invoice} client={owed.get(invoice.id)?.client ?? t('money.aClient')} />)}
        </ul>
      )}
      {problems.map((problem) => <p key={problem} className={s.refusal} role="status" data-engine-line="">{problem}</p>)}
    </div>
  );
}

/** A reminder the Billing agent drafted: who it is for, and Open, which shows it to send yourself. */
function Drafted({ invoice, client }: { invoice: InvoiceLite; client: string }) {
  const t = useT();
  return (
    <li className={v.draft}>
      <span className={v.draftText}>{t('money.remind.ready', { client, number: invoice.number ?? '' })}</span>
      <Button size="sm" variant="quiet" onClick={(event) => openSheet('outreach', invoice.next!.draftId!, event.currentTarget)}>{t('money.remind.open')}</Button>
    </li>
  );
}

/** Open invoices as rows: the client, the number (it opens the invoice) and due date, and the balance when proved. */
export function OpenList({ items, balances, className }: { items: readonly OpenInvoice[]; balances: boolean; className?: string | undefined }) {
  const t = useT();
  const day = useDay();
  return (
    <ul className={className ?? s.openList}>
      {items.map((item) => (
        <li key={item.invoiceId} className={s.openItem}>
          <span className={s.openText}>
            <span className={s.openClient} data-client="">{item.clientName}</span>
            <span className={s.openSub}>
              <InvoiceRef id={item.invoiceId} number={item.number} />
              <span aria-hidden="true">·</span>
              <span>{t('money.due', { date: day(item.dueDate) })}</span>
            </span>
          </span>
          {balances && <span className={`${s.openAmount} mono`}>{item.balanceDisplay}</span>}
        </li>
      ))}
    </ul>
  );
}
