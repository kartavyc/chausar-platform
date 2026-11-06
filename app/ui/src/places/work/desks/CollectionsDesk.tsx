/** Collections screen after finance-skills (MIT ideas); original Ink components, no money arithmetic. */
import { useId, useState } from 'react';
import { useT } from '../../../text';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { EmptyState } from '../../../parts/EmptyState';
import s from './CollectionsDesk.module.css';

type PromiseRow = { id: string; clientName: string; statedBy: string; promisedOn: string; status: 'kept' | 'pending' | 'broken'; stage: string; stageName: string; digest: string };
type ClientInvoiceRow = { id: string; clientId: string; clientName: string; serviceOrderId: string; sourceName: string; invoiceId: string; number: string; debtor: string };
type LadderRow = { id: string; ladder: { id: string; fromDay: number; name: string }[]; digest: string };
const BOOKKEEPING = 'bookkeeping-cfo' as const;
const STAGES = ['reminder', 'call', 'formal', 'lawyer', 'writeoff'];

/** The client reviews and sends all reminders. The desk only records owner-approved promises and stages. */
export function CollectionsDesk() {
  const t = useT();
  const client = useEngine();
  const heading = useId(), invoiceLabel = useId();
  const promises = useResource('venture.desk.list', { playbook: BOOKKEEPING, kind: 'promise' }, { refreshOn: event => event.type === 'desk.changed' || event.type === 'queue.changed' });
  const invoices = useResource('venture.desk.list', { playbook: BOOKKEEPING, kind: 'ledger' }, { refreshOn: event => event.type === 'queue.changed' });
  const ladder = useResource('venture.desk.get', { playbook: BOOKKEEPING, kind: 'ladder', id: 'configuration' }, { refreshOn: event => event.type === 'desk.changed' });
  const invoiceRows = (invoices.data?.rows ?? []) as ClientInvoiceRow[];
  const [adding, setAdding] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [on, setOn] = useState('');
  const [who, setWho] = useState('');
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<PromiseRow | null>(null);
  const [note, setNote] = useState('');
  const [prepared, setPrepared] = useState<string | null>(null);
  const [editedLadder, setEditedLadder] = useState<LadderRow | null>(null);
  const rows = (promises.data?.rows ?? []) as PromiseRow[];
  const config = ladder.data?.item as LadderRow | undefined;
  const fail = (e: unknown) => setError(t(`pb-bookkeeping-cfo.error.${e instanceof EngineError ? e.code : 'REQUEST_FAILED'}`));
  const stageName = (row: { id: string; name: string }) => STAGES.includes(row.id) ? t(`pb-bookkeeping-cfo.stage.${row.id}`) : row.name;
  async function record() {
    const invoice = invoiceRows.find(row => row.id === invoiceId);
    if (!invoice || busy || !amount || !on || !who.trim() || !method.trim()) return;
    setBusy(true); setError(null);
    try {
      await client.request('venture.desk.act', { playbook: BOOKKEEPING, kind: 'promise', id: 'new', action: 'record', payload: { clientId: invoice.clientId, serviceOrderId: invoice.serviceOrderId, sourceName: invoice.sourceName, invoiceIds: [invoice.invoiceId], amountRupees: amount, promisedOn: on, method, statedBy: who } });
      setAdding(false); setAmount(''); setWho(''); setMethod(''); promises.reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function prepareNote() {
    if (!noteFor || !note.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await client.request('venture.desk.act', { playbook: BOOKKEEPING, kind: 'promise', id: noteFor.id, action: 'reminder', digest: noteFor.digest, payload: { text: note } });
      setPrepared((result.result as { text: string }).text); setNoteFor(null); setNote('');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function saveStages() {
    if (!editedLadder || busy) return;
    setBusy(true); setError(null);
    try {
      await client.request('venture.desk.act', { playbook: BOOKKEEPING, kind: 'ladder', id: 'configuration', action: 'set', digest: editedLadder.digest, payload: { ladder: editedLadder.ladder } });
      setEditedLadder(null); ladder.reload(); promises.reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  return <div className={s.desk}>
    <Tile as="section" labelledBy={heading}>
      <TileHead id={heading} title={t('pb-bookkeeping-cfo.heading')} />
      <p className={s.boundary}>{t('pb-bookkeeping-cfo.boundary')}</p>
      {(error || promises.error || invoices.error || ladder.error) && <p role="alert" className={s.error}>{error ?? t('pb-bookkeeping-cfo.error.REQUEST_FAILED')}</p>}
      {promises.loading && !promises.data && <p role="status">{t('pb-bookkeeping-cfo.loading')}</p>}
      {promises.data && rows.length === 0 && <EmptyState title={t('pb-bookkeeping-cfo.empty')} line={t('pb-bookkeeping-cfo.emptyLine')} />}
      <ul className={s.list}>
        {rows.map(row => <li key={row.id} className={s.row} data-row="">
          <div><strong data-content="">{row.clientName}</strong><p data-content="">{row.statedBy}</p></div>
          <div><p>{t(`pb-bookkeeping-cfo.status.${row.status}`)}</p><p>{t('pb-bookkeeping-cfo.due', { date: row.promisedOn })}</p><p>{STAGES.includes(row.stage) ? t(`pb-bookkeeping-cfo.stage.${row.stage}`) : <span data-content="">{row.stageName}</span>}</p></div>
          <Button variant="quiet" onClick={() => { setNoteFor(row); setPrepared(null); }}>{t('pb-bookkeeping-cfo.clientNote')}</Button>
        </li>)}
      </ul>
      {!adding && <Button variant="primary" onClick={() => setAdding(true)}>{t('pb-bookkeeping-cfo.add')}</Button>}
      {adding && <form className={s.form} onSubmit={event => { event.preventDefault(); void record(); }}>
        <label htmlFor={invoiceLabel}>{t('pb-bookkeeping-cfo.invoice')}</label>
        <select id={invoiceLabel} className={s.select} value={invoiceId} onChange={event => setInvoiceId(event.target.value)} required>
          <option value="">{t('pb-bookkeeping-cfo.chooseInvoice')}</option>
          {invoiceRows.map(row => <option key={row.id} value={row.id}>{row.number}: {row.debtor} / {row.clientName}</option>)}
        </select>
        <Field label={t('pb-bookkeeping-cfo.amount')} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required />
        <Field label={t('pb-bookkeeping-cfo.date')} type="date" value={on} onChange={event => setOn(event.target.value)} required />
        <Field label={t('pb-bookkeeping-cfo.who')} value={who} maxLength={120} onChange={event => setWho(event.target.value)} required />
        <Field label={t('pb-bookkeeping-cfo.method')} value={method} maxLength={80} onChange={event => setMethod(event.target.value)} required />
        <div className={s.actions}><Button onClick={() => setAdding(false)}>{t('pb-bookkeeping-cfo.cancel')}</Button><Button type="submit" variant="primary" disabled={busy} locked={!invoiceId || !amount || !on || !who.trim() || !method.trim()} lockedReason={t('pb-bookkeeping-cfo.complete')}>{t('pb-bookkeeping-cfo.record')}</Button></div>
      </form>}
    </Tile>
    {noteFor && <Tile as="section" label={t('pb-bookkeeping-cfo.clientNote')} card>
      <p>{t('pb-bookkeeping-cfo.noteBoundary')}</p>
      <Field multiline label={t('pb-bookkeeping-cfo.note')} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
      <div className={s.actions}><Button onClick={() => setNoteFor(null)}>{t('pb-bookkeeping-cfo.cancel')}</Button><Button variant="primary" disabled={busy} locked={!note.trim()} onClick={() => void prepareNote()}>{t('pb-bookkeeping-cfo.prepare')}</Button></div>
    </Tile>}
    {prepared && <Tile as="section" label={t('pb-bookkeeping-cfo.prepared')}><p>{t('pb-bookkeeping-cfo.noteBoundary')}</p><blockquote data-content="">{prepared}</blockquote></Tile>}
    <Tile as="section" label={t('pb-bookkeeping-cfo.stages')} card>
      <details><summary>{t('pb-bookkeeping-cfo.stages')}</summary>
        <p className={s.boundary}>{t('pb-bookkeeping-cfo.stageBoundary')}</p>
        {(editedLadder?.ladder ?? config?.ladder ?? []).map((row, index) => <div key={row.id} className={s.stage}>
          <span>{stageName(row)}</span>
          {editedLadder ? <Field label={t('pb-bookkeeping-cfo.fromDay', { stage: stageName(row) })} type="number" min={1} value={row.fromDay} onChange={event => setEditedLadder(current => current && { ...current, ladder: current.ladder.map((item, at) => at === index ? { ...item, fromDay: Number(event.target.value) } : item) })} /> : <span>{t('pb-bookkeeping-cfo.day', { day: row.fromDay })}</span>}
        </div>)}
        {config && !editedLadder && <Button variant="quiet" onClick={() => setEditedLadder(structuredClone(config))}>{t('pb-bookkeeping-cfo.editStages')}</Button>}
        {editedLadder && <div className={s.actions}><Button onClick={() => setEditedLadder(null)}>{t('pb-bookkeeping-cfo.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => void saveStages()}>{t('pb-bookkeeping-cfo.saveStages')}</Button></div>}
      </details>
    </Tile>
  </div>;
}
