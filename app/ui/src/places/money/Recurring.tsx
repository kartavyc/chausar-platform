/**
 * Invoices that repeat (W4 4J5, M12; venture.invoice.recurring and .recurringList): one offer for one client, every
 * month or every three months, from a start day and to an end day if the owner gives one. On each due day the engine
 * makes a draft invoice and puts it on Today to check and issue; it never issues one by itself, and the line says so.
 * Each schedule reads in the UI's words from its fields (client, offer, how often, the next draft), so it reads in
 * Hindi too. Setting one up asks for the client, the offer from the plan, how often and from when; the price is the
 * offer's, priced when each draft is made.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { RecurringInvoiceView } from '../../engine/types';
import { Tile } from '../../parts/Tile';
import { messageOf, onMoney, useDay, useLocalToday } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

export function Recurring() {
  const t = useT();
  const day = useDay();
  const list = useResource('venture.invoice.recurringList', {}, { refreshOn: onMoney });
  const clients = useResource('venture.client.list', {}, { refreshOn: onMoney });
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: onMoney });
  const names = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const offers = plan.data?.blueprint.offers ?? [];
  const offerName = new Map(offers.map((offer) => [offer.id, offer.name.value]));
  const items = list.data?.items ?? [];
  const [adding, setAdding] = useState(false);
  if (list.error) return null;

  const words = (item: RecurringInvoiceView) => t('money.recurring.item', {
    client: names.get(item.clientId) ?? t('money.aClient'), offer: offerName.get(item.offerId) ?? t('money.recurring.offer'),
    every: t(`money.recurring.every.${item.frequency}`),
  });

  return (
    // Simple first (4J20): one step away, in a fold under the invoices; its title is all it shows until opened.
    <details className={`${v.moreFold} ${s.section}`}>
      <summary className={v.moreSummary}>{t('money.recurring.title')}</summary>
      {/* The summary names it once; the tile under it carries no second label. */}
      <Tile className={v.repeatTile}>
      {!adding && offers.length > 0 && (clients.data ?? []).length > 0 && <p className={s.buttons}><Button size="sm" onClick={() => setAdding(true)}>{t('money.recurring.add')}</Button></p>}
      {items.length === 0 && !adding && <p className={s.quietLine}>{t('money.recurring.none')}</p>}
      {items.length > 0 && (
        <ul className={v.plainList}>
          {items.map((item) => (
            <li key={item.id} className={v.plainItem}>
              <span className={v.plainTitle}>{words(item)}</span>
              <span className={v.quiet}>
                {item.nextOn ? t('money.recurring.next', { date: day(item.nextOn) }) : t('money.recurring.ended')}
                {item.end && ` · ${t('money.recurring.until', { date: day(item.end) })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.quietLine}>{t('money.recurring.never')}</p>
      {adding && <AddRecurring clients={clients.data ?? []} offers={offers.map((offer) => ({ id: offer.id, name: offer.name.value }))} onDone={() => { setAdding(false); list.reload(); }} onCancel={() => setAdding(false)} />}
      </Tile>
    </details>
  );
}

function AddRecurring({ clients, offers, onDone, onCancel }: { clients: readonly { id: string; name: string }[]; offers: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const engine = useEngine();
  const today = useLocalToday();
  const ids = { client: useId(), offer: useId(), often: useId() };
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [offerId, setOfferId] = useState(offers[0]?.id ?? '');
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>('monthly');
  const [startOn, setStartOn] = useState(today);
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.invoice.recurring', { clientId, offerId, frequency, startOn, ...(end ? { end } : {}) });
      onDone();
    } catch (error) {
      setProblem(t('money.recurring.failed', { message: messageOf(error) }));
      setBusy(false);
    }
  }

  return (
    <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={s.field}>
        <label htmlFor={ids.client} className={s.fieldLabel}>{t('money.table.client')}</label>
        <select id={ids.client} className={s.select} value={clientId} disabled={busy} onChange={(event) => setClientId(event.currentTarget.value)}>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </div>
      <div className={s.field}>
        <label htmlFor={ids.offer} className={s.fieldLabel}>{t('money.recurring.offer')}</label>
        <select id={ids.offer} className={s.select} value={offerId} disabled={busy} onChange={(event) => setOfferId(event.currentTarget.value)}>
          {offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
        </select>
      </div>
      <div className={s.field}>
        <label htmlFor={ids.often} className={s.fieldLabel}>{t('money.recurring.often')}</label>
        <select id={ids.often} className={s.select} value={frequency} disabled={busy} onChange={(event) => setFrequency(event.currentTarget.value as 'monthly' | 'quarterly')}>
          <option value="monthly">{t('money.recurring.every.monthly')}</option>
          <option value="quarterly">{t('money.recurring.every.quarterly')}</option>
        </select>
      </div>
      <Field label={t('money.recurring.start')} type="date" value={startOn} disabled={busy} onChange={(event) => setStartOn(event.currentTarget.value)} />
      <Field label={t('money.recurring.end')} hint={t('money.recurring.endHint')} type="date" value={end} disabled={busy} onChange={(event) => setEnd(event.currentTarget.value)} />
      <div className={s.buttons}>
        <Button disabled={busy} onClick={onCancel}>{t('approval.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy || !clientId || !offerId}>{t('money.recurring.save')}</Button>
      </div>
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </form>
  );
}
