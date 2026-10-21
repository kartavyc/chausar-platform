/**
 * Invoices: drafts to check and issue, open invoices waiting for payment, closed ones, and the orders not invoiced
 * yet. Each row shows the invoice's total from the engine beside the receipt that priced it; an open one also shows
 * what is still owed, as the engine wrote it. Issuing and recording a payment happen in the sheet beside the list.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import type { InvoiceLite, OrderLite } from '../../engine/types';
import { Failed, Figure, Section } from './parts';
import { invoiceTitle, messageOf, onMoney, statusOf, useDay } from './words';
import s from './Money.module.css';

export function Invoices() {
  const t = useT();
  const invoices = useResource('venture.invoice.list', {}, { refreshOn: onMoney });
  const orders = useResource('venture.order.list', {}, { refreshOn: onMoney });
  const clients = useResource('venture.client.list', {}, { refreshOn: onMoney });
  const names = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const list = invoices.data ?? [];
  const drafts = list.filter((invoice) => invoice.status === 'draft');
  const open = list.filter((invoice) => invoice.status === 'issued' || invoice.status === 'part-paid');
  const closed = list.filter((invoice) => invoice.status === 'paid' || invoice.status === 'void');
  const invoiced = new Set(list.filter((invoice) => invoice.status !== 'void').map((invoice) => invoice.orderId));
  const toInvoice = (orders.data ?? []).filter((order) => order.status !== 'cancelled' && order.status !== 'invoiced' && !invoiced.has(order.id));
  const reload = () => { invoices.reload(); orders.reload(); };

  const group = (title: string, items: InvoiceLite[]) => items.length > 0 && (
    <Section title={title}>
      <ul className={s.list}>
        {items.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} client={names.get(invoice.clientId)} />)}
      </ul>
    </Section>
  );

  return (
    <>
      {invoices.error && <Failed error={invoices.error} />}
      {orders.error && <Failed error={orders.error} />}
      {invoices.data && orders.data && list.length === 0 && toInvoice.length === 0 && (
        <EmptyState title={t('money.invoices.none')} line={t('money.invoices.noneLine')} />
      )}
      {group(t('money.invoices.drafts'), drafts)}
      {group(t('money.invoices.open'), open)}
      {group(t('money.invoices.closed'), closed)}
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

/** One invoice. Its figures come from venture.invoice.get, so the row never works out a total or a balance. */
function InvoiceRow({ invoice, client }: { invoice: InvoiceLite; client: string | undefined }) {
  const t = useT();
  const day = useDay();
  const view = useResource('venture.invoice.get', { invoiceId: invoice.id }, { refreshOn: onMoney });
  const who = client ?? view.data?.client.name ?? t('money.aClient');
  const total = view.data?.figures.find((figure) => figure.key === 'total');
  const balance = view.data?.figures.find((figure) => figure.key === 'balance');
  const owing = invoice.status === 'issued' || invoice.status === 'part-paid';
  const open = (origin: HTMLElement) => openSheet('invoice', invoice.id, origin);

  const action = invoice.status === 'draft'
    ? <Button variant="primary" data-key="primary" onClick={(event) => open(event.currentTarget)}>{t('money.invoices.review')}</Button>
    : owing
      ? <Button variant="primary" data-key="primary" onClick={(event) => openSheet('payment', invoice.id, event.currentTarget)}>{t('money.invoices.record')}</Button>
      : undefined;

  return (
    <Row
      id={invoice.id}
      title={invoiceTitle(t, invoice, who)}
      line={statusOf(t, day, { ...invoice, dueInDays: view.data?.invoice.dueInDays })}
      onOpen={open}
      actions={action}
    >
      {view.error && <p className={s.quiet}>{t('money.failed', { message: view.error.message })}</p>}
      {view.data && total && (
        <p className={s.figures}>
          <span className={s.figureLabel}>{t('money.invoices.total')}</span>
          {' '}<Figure>{total.display}</Figure>{' '}
          <Receipt id={view.data.invoice.priceReceiptId} />
          {owing && balance && (
            <>
              <span className={s.dot} aria-hidden="true">·</span>
              <span className={s.figureLabel}>{t('money.invoices.owed')}</span>
              {' '}<Figure>{balance.display}</Figure>
            </>
          )}
        </p>
      )}
    </Row>
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
      title={t('money.order.title', { client: client ?? t('money.aClient'), request: order.request })}
      line={order.deliveredOn ? t('money.order.delivered', { date: day(order.deliveredOn) }) : t('money.order.notDelivered')}
      actions={<Button variant="primary" data-key="primary" disabled={busy} onClick={(event) => void prepare(event.currentTarget)}>{t('money.invoices.prepare')}</Button>}
    >
      <p className={s.figures}>
        <span className={s.figureLabel}>{t('money.order.priced')}</span>
        {' '}<Receipt id={order.priceReceiptId} />
      </p>
      {refusal && <p className={s.refusal} role="status">{refusal}</p>}
    </Row>
  );
}
