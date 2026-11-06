import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * Invoices (D-Money `.invs`, `.itile`, `.itab`): one table of every invoice, drafts to check and issue first, then the
 * open ones waiting for payment, then the closed ones; and under it the orders not invoiced yet. Each row shows the
 * invoice's total as the engine wrote it, with the receipt that priced it in its own column; the row is one
 * `data-figure-group`, so that receipt proves the amount beside it. The list rows carry their total and receipt, so the
 * list makes no call per row. Issuing and recording a payment happen in the sheet beside the list, where issuing still
 * asks a second time.
 *
 * On a phone each row becomes a small card and the column heads are hidden, so the amount carries its own label and the
 * due date reads as a sentence ("Due 28 Oct 2026"). The table, its row groups, rows, heads and cells carry their roles
 * explicitly: Safari drops a table's semantics once CSS changes how it is drawn.
 *
 * W4 4J20: an open invoice past its due day says how late it is (the engine's `late`, worded here), and its action is
 * its one next step by state (the engine's `next`): Remind drafts a payment reminder the owner sends from their own app
 * (venture.invoice.remind, then 4E4's draft sheet), a drafted one opens, and a cheque waiting to clear opens the invoice
 * where it is marked cleared. Under the table, invoices that repeat (Recurring.tsx).
 *
 * One-shot C4 (T21): the table reads in sections: drafts (only when there are some), Issued and Paid, each under its
 * own heading row, with "No invoices yet" under an empty one. Cancelled invoices sit with the paid ones, as before.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useRoute, openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { SectionHead, Tile } from '../../parts/Tile';
import type { InvoiceLite, OrderLite } from '../../engine/types';
import { keepDraft } from '../clients/handoff';
import { EngineWords, Failed, Section } from './parts';
import { Recurring } from './Recurring';
import { invoiceChip, onMoney, useDay } from './words';
import s from './Money.module.css';
import sLocal from './Invoices.module.css';
import v from './MoneyViews.module.css';

const ORDER: Readonly<Record<InvoiceLite['status'], number>> = { draft: 0, issued: 1, 'part-paid': 1, paid: 2, void: 2 };
/** C4 (T21): the table's sections, in order; drafts show only when there are some. */
const GROUPS = [{ group: 0, key: 'draft', always: false }, { group: 1, key: 'issued', always: true }, { group: 2, key: 'paid', always: true }] as const;
const COLUMNS = 7;

export function Invoices() {
  const t = useT();
  const headId = useId();
  const invoices = useResource('venture.invoice.list', {}, { refreshOn: onMoney });
  const orders = useResource('venture.order.list', {}, { refreshOn: onMoney });
  const clients = useResource('venture.client.list', {}, { refreshOn: onMoney });
  const names = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const requests = new Map((orders.data ?? []).map((order) => [order.id, order.request]));
  const list = invoices.data ?? [];
  // Drafts first, then open, then closed; the engine's own order inside each.
  const rows = [0, 1, 2].flatMap((group) => list.filter((invoice) => ORDER[invoice.status] === group));
  const inGroup = (group: number) => rows.filter((invoice) => ORDER[invoice.status] === group);
  // 6D1: an order billed only by issued parts, none of them the final one, still has the rest to bill.
  const invoiced = new Set(list.filter((invoice) => invoice.status !== 'void' && (invoice.status === 'draft' || !invoice.part || invoice.part.kind === 'final')).map((invoice) => invoice.orderId));
  const toInvoice = (orders.data ?? []).filter((order) => order.status !== 'cancelled' && order.status !== 'invoiced' && !invoiced.has(order.id));
  const reload = () => { invoices.reload(); orders.reload(); };

  return (
    <>
      {invoices.error && <Failed error={invoices.error} />}
      {orders.error && <Failed error={orders.error} />}
      {invoices.data && orders.data && list.length === 0 && toInvoice.length === 0 && (
        <Tile><EmptyState title={t('money.invoices.none')} line={t('money.invoices.noneLine')} /></Tile>
      )}
      {rows.length > 0 && (
        <section className={s.section} aria-labelledby={headId}>
          <SectionHead id={headId} title={t('money.sub.invoices')} />
          <Tile pad="none" className={s.tableTile}>
            <table className={sLocal.table} role="table">
              <caption className="sr-only">{t('money.table.caption')}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader" className={sLocal.colNumber}>{t('money.table.invoice')}</th>
                  <th scope="col" role="columnheader">{t('money.table.client')}</th>
                  <th scope="col" role="columnheader" className={sLocal.colAmount}>{t('money.table.amount')}</th>
                  <th scope="col" role="columnheader" className={sLocal.colStatus}>{t('money.table.status')}</th>
                  <th scope="col" role="columnheader" className={sLocal.colDue}>{t('money.table.due')}</th>
                  <th scope="col" role="columnheader" className={sLocal.colReceipt}>{t('money.table.receipt')}</th>
                  <th scope="col" role="columnheader" className={sLocal.colAction}><span className="sr-only">{t('money.table.action')}</span></th>
                </tr>
              </thead>
              {GROUPS.filter(({ group, always }) => always || inGroup(group).length > 0).map(({ group, key }) => (
                <tbody key={key} role="rowgroup" data-group={key}>
                  <tr role="row" className={sLocal.groupRow}>
                    <th role="rowheader" scope="colgroup" colSpan={COLUMNS} className={sLocal.groupHead}>{t(`money.invoices.group.${key}`)}</th>
                  </tr>
                  {inGroup(group).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} client={names.get(invoice.clientId)} request={requests.get(invoice.orderId)} />)}
                  {inGroup(group).length === 0 && (
                    <tr role="row" className={sLocal.groupRow}><td role="cell" colSpan={COLUMNS} className={sLocal.groupEmpty}>{t('money.invoices.groupEmpty')}</td></tr>
                  )}
                </tbody>
              ))}
            </table>
          </Tile>
        </section>
      )}
      {toInvoice.length > 0 && (
        <Section title={t('money.invoices.toInvoice')}>
          <ul className={s.list}>
            {toInvoice.map((order) => <OrderRow key={order.id} order={order} client={names.get(order.clientId)} onPrepared={reload} />)}
          </ul>
        </Section>
      )}
      {invoices.data && <Recurring />}
    </>
  );
}

/**
 * One invoice as a table row. Its total and receipt come with the list row; an older engine that sends neither is read
 * once with venture.invoice.get. Either way the row never works out a total or a balance. The number opens the invoice
 * (Enter on the row too); a draft's Issue opens it to be checked and issued there.
 */
function InvoiceRow({ invoice, client, request }: { invoice: InvoiceLite; client: string | undefined; request: string | undefined }) {
  const t = useT();
  const day = useDay();
  const route = useRoute();
  const carried = invoice.total !== undefined && invoice.receiptId !== undefined;
  const view = useResource('venture.invoice.get', { invoiceId: invoice.id }, { refreshOn: onMoney, skip: carried });
  const who = client ?? view.data?.client.name ?? t('money.aClient');
  const total = carried ? invoice.total : view.data?.figures.find((figure) => figure.key === 'total')?.display;
  const receiptId = carried ? invoice.receiptId : view.data?.invoice.priceReceiptId;
  const proved = total !== undefined && receiptId !== undefined;
  const open = (origin: HTMLElement) => openSheet('invoice', invoice.id, origin);
  const owing = invoice.status === 'issued' || invoice.status === 'part-paid';
  const dueInDays = view.data?.invoice.dueInDays;

  // The due date under its column head; on a phone, where the heads are hidden, as a sentence.
  let due = null;
  if (owing && invoice.dueDate) {
    due = (
      <>
        <span className={sLocal.wideOnly} data-num="">{day(invoice.dueDate)}</span>
        <span className={sLocal.phoneOnly} data-phone-label="">{t('money.due', { date: day(invoice.dueDate) })}</span>
      </>
    );
  } else if (invoice.status === 'draft') {
    due = (
      <>
        <span className={cx(sLocal.phoneOnly, sLocal.cellLabel)} data-phone-label="">{t('money.table.due')}</span>
        {dueInDays === undefined ? t('money.table.dueOnIssue') : t('money.table.dueAfter', { count: String(dueInDays) })}
      </>
    );
  }

  let action;
  const next = invoice.next;
  if (invoice.status === 'draft') {
    action = <Button variant={route.sheet ? "secondary" : "primary"} size="sm" data-key="primary" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.issue')}</Button>;
  } else if (owing && next?.action === 'remind') {
    // 4J5: the reminder's day has come. Drafted already: open it to send it yourself; else ask the Billing agent for it.
    action = next.draftId
      ? <Button size="sm" data-key="primary" onClick={(event) => openSheet('outreach', next.draftId!, event.currentTarget)}>{t('money.remind.open')}</Button>
      : <RemindButton invoiceId={invoice.id} />;
  } else if (owing && next?.action === 'clear') {
    action = <Button size="sm" data-key="primary" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.clear')}</Button>;
  } else if (owing) {
    action = <Button size="sm" data-key="primary" onClick={(event) => openSheet('payment', invoice.id, event.currentTarget)}>{t('money.invoices.record')}</Button>;
  } else {
    action = <Button size="sm" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.open')}</Button>;
  }

  return (
    <tr className={sLocal.tr} role="row" data-row="" data-row-id={invoice.id} tabIndex={-1} data-figure-group={proved ? '' : undefined}>
      <td role="cell" className={sLocal.cellNumber}>
        <button
          type="button"
          data-code="" className={cx(s.invoiceNo, invoice.number && 'mono')}
          data-open=""
          aria-label={invoice.number ? t('money.invoiceRef', { number: invoice.number }) : t('money.invoices.draftTitle', { client: who })}
          onClick={(event) => open(event.currentTarget)}
        >
          {invoice.number ?? t('money.invoices.unnumbered')}
        </button>
      </td>
      <td role="cell" className={sLocal.cellClient}>
        <span className={sLocal.client}>
          <Avatar name={who} size={32} />
          <span className={sLocal.clientText}>
            <span className={sLocal.clientName}>{who}</span>
            {request && <span className={sLocal.clientSub}>{request}</span>}
          </span>
        </span>
      </td>
      <td role="cell" className={sLocal.cellAmount}>
        {proved && <span className={cx(sLocal.phoneOnly, sLocal.cellLabel)} data-phone-label="">{t('money.table.amount')}</span>}
        {proved && <span className={sLocal.amount} data-num="">{total}</span>}
        {view.error && <EngineWords className={sLocal.quietSmall}>{t('money.failed', { message: view.error.message })}</EngineWords>}
      </td>
      <td role="cell" className={sLocal.cellStatus}><StateChip kind="invoice" value={invoiceChip(invoice)} /></td>
      <td role="cell" className={sLocal.cellDue}>
        {due}
        {/* 4J4: how late, from the engine's whole days (its line worded here). */}
        {owing && invoice.late && <span className={v.late} data-late="">{t('money.late', { count: String(invoice.late.days) })}</span>}
      </td>
      <td role="cell" className={sLocal.cellReceipt}>{proved && <Receipt id={receiptId} amount={total} />}</td>
      <td role="cell" className={sLocal.cellAction}>{action}</td>
    </tr>
  );
}

/**
 * Remind (4J5, M12): the Billing agent drafts a payment reminder from the invoice's own figures
 * (venture.invoice.remind); the draft sheet opens so the owner sends it from their own app. Nothing is sent here.
 */
function RemindButton({ invoiceId }: { invoiceId: string }) {
  const t = useT();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function remind(origin: HTMLElement) {
    setBusy(true);
    setRefusal(null);
    try {
      const made = await engine.request('venture.invoice.remind', { invoiceId });
      keepDraft(engine, made.draft);
      openSheet('outreach', made.draft.id, origin);
    } catch (error) {
      setRefusal(t('money.remind.failedOne', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" data-key="primary" disabled={busy} onClick={(event) => void remind(event.currentTarget)}>{t('money.invoices.remind')}</Button>
      {refusal && <span className={s.refusal} role="status" data-engine-line="">{refusal}</span>}
    </>
  );
}

/** An order with no invoice yet: its price is on its receipt; Prepare invoice makes a draft to check. */
function OrderRow({ order, client, onPrepared }: { order: OrderLite; client: string | undefined; onPrepared: () => void }) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function prepare(origin: HTMLElement) {
    setBusy(true);
    setRefusal(null);
    try {
      const view = await engine.request('venture.invoice.prepare', { orderId: order.id });
      onPrepared();
      openSheet('invoice', view.invoice.id, origin);
    } catch (error) {
      setRefusal(t('money.invoices.prepareFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row
      id={order.id}
      mark={<Avatar name={client ?? t('money.aClient')} size={32} />}
      title={t('money.order.title', { client: client ?? t('money.aClient'), request: order.request })}
      line={order.deliveredOn ? t('money.order.delivered', { date: day(order.deliveredOn) }) : t('money.order.notDelivered')}
      aside={<span className={sLocal.priced}><span>{t('money.order.priced')}</span><Receipt id={order.priceReceiptId} /></span>}
      actions={<Button variant="primary" data-key="primary" disabled={busy} onClick={(event) => void prepare(event.currentTarget)}>{t('money.invoices.prepare')}</Button>}
    >
      {refusal && <p className={s.refusal} role="status" data-engine-line="">{refusal}</p>}
    </Row>
  );
}
