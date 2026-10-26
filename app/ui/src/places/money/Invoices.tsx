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
 * Lateness is not a state the engine sends yet (W4 4J), so no row is marked late, and reminders wait for W4 4E.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { SectionHead, Tile } from '../../parts/Tile';
import type { InvoiceLite, OrderLite } from '../../engine/types';
import { EngineWords, Failed, Section } from './parts';
import { messageOf, onMoney, useDay } from './words';
import s from './Money.module.css';

const ORDER: Readonly<Record<InvoiceLite['status'], number>> = { draft: 0, issued: 1, 'part-paid': 1, paid: 2, void: 2 };

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
  const invoiced = new Set(list.filter((invoice) => invoice.status !== 'void').map((invoice) => invoice.orderId));
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
            <table className={s.table} role="table">
              <caption className="sr-only">{t('money.table.caption')}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader" className={s.colNumber}>{t('money.table.invoice')}</th>
                  <th scope="col" role="columnheader">{t('money.table.client')}</th>
                  <th scope="col" role="columnheader" className={s.colAmount}>{t('money.table.amount')}</th>
                  <th scope="col" role="columnheader" className={s.colStatus}>{t('money.table.status')}</th>
                  <th scope="col" role="columnheader" className={s.colDue}>{t('money.table.due')}</th>
                  <th scope="col" role="columnheader" className={s.colReceipt}>{t('money.table.receipt')}</th>
                  <th scope="col" role="columnheader" className={s.colAction}><span className="sr-only">{t('money.table.action')}</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} client={names.get(invoice.clientId)} request={requests.get(invoice.orderId)} />)}
              </tbody>
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
        <span className={cx(s.wideOnly, 'mono')}>{day(invoice.dueDate)}</span>
        <span className={s.phoneOnly} data-phone-label="">{t('money.due', { date: day(invoice.dueDate) })}</span>
      </>
    );
  } else if (invoice.status === 'draft') {
    due = (
      <>
        <span className={cx(s.phoneOnly, s.cellLabel)} data-phone-label="">{t('money.table.due')}</span>
        {dueInDays === undefined ? t('money.table.dueOnIssue') : t('money.table.dueAfter', { count: String(dueInDays) })}
      </>
    );
  }

  let action;
  if (invoice.status === 'draft') {
    action = <Button variant="primary" size="sm" data-key="primary" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.issue')}</Button>;
  } else if (owing) {
    action = <Button size="sm" data-key="primary" onClick={(event) => openSheet('payment', invoice.id, event.currentTarget)}>{t('money.invoices.record')}</Button>;
  } else {
    action = <Button size="sm" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.open')}</Button>;
  }

  return (
    <tr className={s.tr} role="row" data-row="" data-row-id={invoice.id} tabIndex={-1} data-figure-group={proved ? '' : undefined}>
      <td role="cell" className={s.cellNumber}>
        <button
          type="button"
          className={cx(s.invoiceNo, invoice.number && 'mono')}
          data-open=""
          aria-label={invoice.number ? t('money.invoiceRef', { number: invoice.number }) : t('money.invoices.draftTitle', { client: who })}
          onClick={(event) => open(event.currentTarget)}
        >
          {invoice.number ?? t('money.status.draftShort')}
        </button>
      </td>
      <td role="cell" className={s.cellClient}>
        <span className={s.client}>
          <Avatar name={who} size={32} />
          <span className={s.clientText}>
            <span className={s.clientName}>{who}</span>
            {request && <span className={s.clientSub}>{request}</span>}
          </span>
        </span>
      </td>
      <td role="cell" className={s.cellAmount}>
        {proved && <span className={cx(s.phoneOnly, s.cellLabel)} data-phone-label="">{t('money.table.amount')}</span>}
        {proved && <span className={cx(s.amount, 'mono')}>{total}</span>}
        {view.error && <EngineWords className={s.quietSmall}>{t('money.failed', { message: view.error.message })}</EngineWords>}
      </td>
      <td role="cell" className={s.cellStatus}><StateChip kind="invoice" value={invoice.status} /></td>
      <td role="cell" className={s.cellDue}>{due}</td>
      <td role="cell" className={s.cellReceipt}>{proved && <Receipt id={receiptId} />}</td>
      <td role="cell" className={s.cellAction}>{action}</td>
    </tr>
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
      aside={<span className={s.priced}><span>{t('money.order.priced')}</span><Receipt id={order.priceReceiptId} /></span>}
      actions={<Button variant="primary" data-key="primary" disabled={busy} onClick={(event) => void prepare(event.currentTarget)}>{t('money.invoices.prepare')}</Button>}
    >
      {refusal && <p className={s.refusal} role="status" data-engine-line="">{refusal}</p>}
    </Row>
  );
}
