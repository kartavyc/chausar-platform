// The booking desk on Work (wave 6, package 6E3): open slots, enquiries, the quote from an order with the owner's own
// price, a deposit as an advance invoice paid through its How to pay UPI link, and reminders the owner approves word for
// word and sends from their own app. Every amount is the engine's, shown as a figure with its receipt.
import { useState } from 'react';
import { useT } from '../../../text';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError, type DeskActView, type OutreachHandoff } from '../../../engine/types';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { Tile, TileHead } from '../../../parts/Tile';
import { copyText, performHandoff } from '../../clients/handoff';
import { reserveTab } from '../../connections/external';
import s from './LessonBooking.module.css';
import { Select } from '../../../parts/Select';

type SlotRow = { id: string; start: string; words: string; minutes: number; note: string; state: 'open' | 'held' | 'booked' | 'closed' };
type MessageView = { id: string; channel: 'email' | 'whatsapp'; text: string; handedOffAt: string | null };
type BookingView = {
  id: string; clientId: string; client: string | null; request: string; status: string; orderId: string | null; line: string;
  slot: { id: string; words: string } | null; quote: { receiptId: string; total: string } | null;
  deposit: { invoiceId: string; number: string | null; status: string; total: string; receiptId: string; digest: string; upi: { link: string } | null } | null;
  messages: MessageView[];
};
type Act = (kind: 'slot' | 'booking', id: string, action: string, payload: unknown, digest?: string) => Promise<DeskActView | null>;
const base = { playbook: 'booking-desk' as const };

export function BookingDeskDesk() {
  const t = useT(), w = (key: string, values?: Record<string, string>) => t('pb-booking.' + key, values);
  const engine = useEngine();
  const refreshOn = (event: { type: string }) => event.type === 'desk.changed';
  const slots = useResource('venture.desk.list', { ...base, kind: 'slot' }, { refreshOn });
  const bookings = useResource('venture.desk.list', { ...base, kind: 'booking' }, { refreshOn });
  const [selected, setSelected] = useState('');
  const detail = useResource('venture.desk.get', { ...base, kind: 'booking', id: selected }, { skip: !selected, refreshOn });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [creating, setCreating] = useState(false);
  const [start, setStart] = useState(''), [minutes, setMinutes] = useState('60');

  const act: Act = async (kind, id, action, payload, digest) => {
    if (busy) return null;
    setBusy(true); setError('');
    try {
      const result = await engine.request('venture.desk.act', { ...base, kind, id, action, payload: payload as never, ...(digest ? { digest } : {}) });
      slots.reload(); bookings.reload(); if (selected) detail.reload();
      return result;
    } catch (e) {
      const key = 'pb-booking.error.' + (e instanceof EngineError ? e.code : 'REQUEST_FAILED'), known = t(key);
      setError(known !== key ? known : e instanceof EngineError ? e.message : w('error.REQUEST_FAILED'));
      return null;
    } finally { setBusy(false); }
  };
  const slotRows = (slots.data?.rows ?? []) as SlotRow[];
  const rows = (bookings.data?.rows ?? []) as { id: string; request: string; status: string }[];
  const booking = selected && detail.data?.item ? detail.data.item as BookingView : null;

  return (
    <section className={s.stack} aria-label={w('title')}>
      <Tile as="section" label={w('slots')}>
        <TileHead title={w('title')} />
        <p className={s.line}>{w('intro')}</p>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <ul className={s.list} aria-label={w('slots')}>
          {slotRows.map(slot => (
            <li key={slot.id} className={s.row} data-row>
              <span>{slot.words}</span><span className={s.line}>{w('state.' + slot.state)}</span>
              {slot.state === 'open' && <Button variant="quiet" disabled={busy} onClick={async () => { const shown = await engine.request('venture.desk.get', { ...base, kind: 'slot', id: slot.id }); await act('slot', slot.id, 'close', {}, shown.digest); }}>{w('closeSlot')}</Button>}
            </li>
          ))}
        </ul>
        <form className={s.form} onSubmit={async event => { event.preventDefault(); if (await act('slot', 'new', 'add', { start, minutes: Number(minutes) })) setStart(''); }}>
          <label className={s.label}>{w('start')}<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className={s.label}>{w('minutes')}<input inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
          <div className={s.row}><Button type="submit" disabled={busy}>{w('addSlot')}</Button></div>
        </form>
      </Tile>
      <Tile as="section" label={w('bookings')}>
        <TileHead title={w('bookings')} end={<Button onClick={() => setCreating(open => !open)}>{w('new')}</Button>} />
        {creating && <Enquiry busy={busy} w={w} save={async payload => { const made = await act('booking', 'new', 'intake', payload); if (made) { setSelected(made.id); setCreating(false); } }} />}
        <ul className={s.list}>{rows.map(row => <li key={row.id} className={s.row}><Button onClick={() => setSelected(row.id)}><span data-content>{row.request}</span></Button><span className={s.line}>{w('status.' + row.status)}</span></li>)}</ul>
      </Tile>
      {booking && <Booking key={booking.id} booking={booking} digest={detail.data?.digest ?? ''} slots={slotRows} busy={busy} act={act} w={w} />}
    </section>
  );
}
BookingDeskDesk.ready = true;

type W = (key: string, values?: Record<string, string>) => string;

function Enquiry({ busy, w, save }: { busy: boolean; w: W; save: (payload: unknown) => Promise<void> }) {
  const clients = useResource('venture.client.list', {});
  const [client, setClient] = useState(''), [request, setRequest] = useState(''), [address, setAddress] = useState(''), [phone, setPhone] = useState('');
  return (
    <form className={s.form} onSubmit={event => { event.preventDefault(); void save({ clientId: client, request, ...(address ? { address } : {}), ...(phone ? { phone } : {}) }); }}>
      <label className={s.label}>{w('client')}<Select value={client} onChange={e => setClient(e.target.value)}><option value="">{w('choose')}</option>{(clients.data ?? []).filter(row => !row.self).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></label>
      <label className={s.label}>{w('request')}<textarea rows={3} value={request} onChange={e => setRequest(e.target.value)} /></label>
      <label className={s.label}>{w('address')}<input value={address} onChange={e => setAddress(e.target.value)} /></label>
      <label className={s.label}>{w('phone')}<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <div className={s.row}><Button type="submit" disabled={busy}>{w('saveEnquiry')}</Button></div>
    </form>
  );
}

function Booking({ booking, digest, slots, busy, act, w }: { booking: BookingView; digest: string; slots: SlotRow[]; busy: boolean; act: Act; w: W }) {
  const orders = useResource('venture.order.list', {});
  const [order, setOrder] = useState(''), [slot, setSlot] = useState(''), [percent, setPercent] = useState(''), [kind, setKind] = useState<'appointment' | 'deposit'>('appointment'), [channel, setChannel] = useState<'email' | 'whatsapp'>('whatsapp');
  const [openError, setOpenError] = useState('');
  const run = (action: string, payload: unknown) => act('booking', booking.id, action, payload, digest);
  const open = async (message: MessageView) => {
    setOpenError('');
    let tab: Window | null = null;
    if (message.channel === 'whatsapp') { try { tab = reserveTab(); } catch { tab = null; } }
    const done = await run('handoff', { messageId: message.id });
    const handoff = (done?.result as { handoff?: OutreachHandoff } | undefined)?.handoff;
    if (!handoff) { tab?.close(); return; }
    try { await performHandoff(handoff, tab); } catch { setOpenError(w('error.POPUP_BLOCKED')); }
  };
  const live = booking.status !== 'done' && booking.status !== 'cancelled';
  return (
    <Tile as="section" label={booking.request}>
      <TileHead title={booking.request.split('\n')[0]!} meta={w('status.' + booking.status)} />
      <p className={s.line}><span data-content>{booking.client ?? ''}</span></p>
      <p className={s.line} data-engine-line>{booking.line}</p>
      {booking.quote && <p className={s.row}><span>{w('quoteLabel')}</span><Figure value={booking.quote.total} receiptId={booking.quote.receiptId} /></p>}
      {live && !booking.deposit && (
        <div className={s.form}>
          <label className={s.label}>{w('order')}<Select value={order} onChange={e => setOrder(e.target.value)}><option value="">{w('choose')}</option>{(orders.data ?? []).filter(row => row.clientId === booking.clientId && row.status !== 'cancelled').map(row => <option key={row.id} value={row.id}>{row.request.slice(0, 60)}</option>)}</Select></label>
          <div className={s.row}><Button disabled={busy} onClick={() => void run('quote', { orderId: order })}>{w('quote')}</Button></div>
        </div>
      )}
      {booking.slot
        ? <p className={s.row}><span>{w('heldLine', { when: booking.slot.words })}</span>{booking.status === 'held' && <Button variant="quiet" disabled={busy} onClick={() => void run('release', {})}>{w('release')}</Button>}</p>
        : live && (
          <div className={s.form}>
            <label className={s.label}>{w('slot')}<Select value={slot} onChange={e => setSlot(e.target.value)}><option value="">{w('choose')}</option>{slots.filter(row => row.state === 'open').map(row => <option key={row.id} value={row.id}>{row.words}</option>)}</Select></label>
            <div className={s.row}><Button disabled={busy} onClick={() => void run('hold', { slotId: slot })}>{w('hold')}</Button></div>
          </div>
        )}
      {booking.deposit
        ? (
          <div className={s.stack}>
            <p className={s.row}><span>{w('depositLabel', { status: w('invoice.' + booking.deposit.status) })}</span><Figure value={booking.deposit.total} receiptId={booking.deposit.receiptId} /></p>
            {booking.deposit.status === 'draft' && <div className={s.row}><Button disabled={busy} onClick={() => void run('issue-deposit', { invoiceDigest: booking.deposit!.digest })}>{w('issue')}</Button></div>}
            {booking.deposit.upi && <div className={s.row}><span className={s.line}>{w('upi')}</span><Button variant="quiet" onClick={() => void copyText(booking.deposit!.upi!.link)}>{w('copyUpi')}</Button></div>}
          </div>
        )
        : live && booking.orderId && (
          <div className={s.form}>
            <label className={s.label}>{w('percent')}<input inputMode="decimal" value={percent} onChange={e => setPercent(e.target.value)} /></label>
            <div className={s.row}><Button disabled={busy} onClick={() => void run('deposit', { percent })}>{w('deposit')}</Button></div>
          </div>
        )}
      {live && (
        <div className={s.form}>
          <label className={s.label}>{w('remindKind')}<Select value={kind} onChange={e => setKind(e.target.value as 'appointment' | 'deposit')}><option value="appointment">{w('kind.appointment')}</option><option value="deposit">{w('kind.deposit')}</option></Select></label>
          <label className={s.label}>{w('channel')}<Select value={channel} onChange={e => setChannel(e.target.value as 'email' | 'whatsapp')}><option value="whatsapp">{w('channel.whatsapp')}</option><option value="email">{w('channel.email')}</option></Select></label>
          <div className={s.row}><Button disabled={busy} onClick={() => void run('remind', { kind, channel })}>{w('remind')}</Button></div>
        </div>
      )}
      {openError && <p role="alert" className={s.error}>{openError}</p>}
      <ul className={s.list}>
        {booking.messages.map(message => (
          <li key={message.id} className={s.stack} data-row>
            <pre className={s.quote} data-content>{message.text}</pre>
            {message.handedOffAt
              ? <div className={s.row}><span className={s.line}>{w('handed')}</span><Button variant="quiet" disabled={busy} onClick={() => void open(message)}>{w('openAgain')}</Button></div>
              : <div className={s.row}><Button variant="primary" disabled={busy} onClick={() => void open(message)}>{w('approve')}</Button></div>}
          </li>
        ))}
      </ul>
      <div className={s.row}>
        {booking.status === 'held' && <Button disabled={busy} onClick={() => void run('confirm', {})}>{w('confirm')}</Button>}
        {booking.status === 'confirmed' && <Button disabled={busy} onClick={() => void run('done', {})}>{w('done')}</Button>}
        {live && <Button variant="quiet" disabled={busy} onClick={() => void run('cancel', {})}>{w('cancel')}</Button>}
      </div>
    </Tile>
  );
}
