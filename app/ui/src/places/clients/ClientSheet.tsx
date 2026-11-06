/**
 * The client sheet (`?sheet=client:<id>`): C4 task 18 leads with their orders (each a link into Work, with its price
 * receipt), their invoices and what they owe, then the client's fields with their evidence, their drafts in plain state
 * words, and the files they sent. `client:new` is the Add client form. Figures arrive formatted from the engine with
 * their receipt; nothing is added up here.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { formatHash } from '../../shell/routes';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Receipt } from '../../parts/Receipt';
import { Sheet } from '../../parts/Sheet';
import { EngineError, type ClientAddParams, type ClientLite, type VentureRunEvent } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { Fields, MoreDetails } from './Fields';
// W5 5A4: the client's brand kit, read by every creative step.
import { BrandKit } from './BrandKit';
import { AiConsent } from './AiConsent';
// W6 6G3, 6G4: the client's company, timeline, lists, dated facts and field history.
import { ClientCrm } from './ClientCrm';
import { InvoiceRef } from '../money/parts';
import { clientsChanged, useClientsChanged } from './signals';
import s from './Clients.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

export function ClientSheet(props: SheetComponentProps) {
  return props.id === 'new' ? <NewClientSheet {...props} /> : <ExistingClientSheet {...props} />;
}

/** Whether this business is registered for GST: only the plan's plain "yes" counts, so while the plan loads, or
 *  when it cannot be read, the tax fields stay folded (simple first). */
function useTaxRegistered(): boolean {
  const plan = useResource('venture.blueprint.get', {});
  return plan.data?.blueprint.backOffice.taxRegistered.value === true;
}

/** What a client owes, as the engine formatted it, through Figure with the receipt behind it. lead: it starts its own line ("Owes"). */
export function Owed({ owed, lead }: { owed: NonNullable<ClientLite['owed']>; lead?: boolean }) {
  const t = useT();
  return (
    <span className={s.owed}>
      <span className={s.owesWord}>{t(lead ? 'clients.owesLead' : 'clients.owes')}</span>{' '}
      <Figure value={owed.display} receiptId={owed.receiptId} />
    </span>
  );
}

function ExistingClientSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const ordersId = useId();
  const draftsId = useId();
  const filesId = useId();
  const clients = useResource('venture.client.list', {}, { refreshOn });
  const evidence = useResource('venture.evidence.list', { subject: `client:${id}` }, { refreshOn });
  const orders = useResource('venture.order.list', {}, { refreshOn });
  const drafts = useResource('venture.delivery.list', {}, { refreshOn });
  const invoices = useResource('venture.invoice.list', {}, { refreshOn });
  const files = useResource('venture.files.list', {}, { refreshOn });
  const registered = useTaxRegistered();
  const brandKit = useResource('venture.brandKit.get', { clientId: id });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  useClientsChanged(engine, () => { clients.reload(); evidence.reload(); brandKit.reload(); });

  /** Dismiss goes to the engine and stays dismissed. The row leaves at once; a refusal brings it back with the reason. */
  async function dismiss(itemId: string) {
    setHidden((ids) => new Set(ids).add(itemId));
    setProblems((map) => { const next = new Map(map); next.delete(itemId); return next; });
    try {
      await engine.request('venture.evidence.dismiss', { id: itemId });
      evidence.reload();
    } catch (error) {
      setHidden((ids) => { const next = new Set(ids); next.delete(itemId); return next; });
      setProblems((map) => new Map(map).set(itemId, error instanceof Error ? error.message : String(error)));
    }
  }

  const client = clients.data?.find((c) => c.id === id);
  const title = clients.error ? t('sheet.failed', { message: clients.error.message })
    : !clients.data ? t('sheet.loading')
      : client ? client.name : t('clients.notFound');

  // Open ones first, each group in the engine's order; the timeline below holds all of them with their dates.
  const isOpen = (status: string) => status === 'open' || status === 'invoiced';
  const theirOrders = client ? (orders.data ?? []).filter((o) => o.clientId === client.id) : [];
  const mine = [...theirOrders.filter((o) => isOpen(o.status)), ...theirOrders.filter((o) => !isOpen(o.status))];
  // Issued ones: a draft invoice is not the client's yet.
  const theirInvoices = client ? (invoices.data ?? []).filter((invoice) => invoice.clientId === client.id && invoice.number !== null) : [];
  const orderIds = new Set(mine.map((o) => o.id));
  const requestOf = new Map(mine.map((o) => [o.id, o.request]));
  const theirDrafts = (drafts.data ?? []).filter((d) => !d.practice && orderIds.has(d.orderId));
  const theirFiles = (files.data ?? []).filter((f) => f.scope.kind === 'order' && orderIds.has(f.scope.orderId));
  const theirMedia = (files.data ?? []).filter(f => f.scope.kind === 'media' && orderIds.has(f.scope.orderId));

  return (
    <Sheet
      label={t('clients.sheet')}
      title={title}
      loading={!clients.data && !clients.error}
      avatar={client ? <Avatar name={client.name} size={40} /> : undefined}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {client && (
        <>
          <AiConsent key={client.id} clientId={client.id} clientName={client.name} />
          {(mine.length > 0 || theirInvoices.length > 0 || client.owed) && <section aria-labelledby={ordersId}>
            <h3 id={ordersId} className={s.heading}>{t('clients.ordersInvoices')}</h3>
            {client.owed && <p className={s.item}><Owed owed={client.owed} lead /></p>}
            {mine.length > 0 && (
              <ul className={s.items} aria-label={t('clients.orders')}>
                {mine.map((order) => (
                  <li key={order.id} className={s.item}>
                    <a className={s.link} href={formatHash({ place: 'work', query: { order: order.id } })}>{order.request}</a>{' '}
                    <span className={s.state}>{t(`clients.status.${order.status}`)}</span>{' '}
                    <Receipt id={order.priceReceiptId} />
                  </li>
                ))}
              </ul>
            )}
            {theirInvoices.length > 0 && (
              <ul className={s.items} aria-label={t('clients.invoices')}>
                {theirInvoices.map((invoice) => (
                  <li key={invoice.id} className={s.item}>
                    <InvoiceRef id={invoice.id} number={invoice.number ?? ''} />{' '}
                    {invoice.total && invoice.receiptId && <><Figure value={invoice.total} receiptId={invoice.receiptId} />{' '}</>}
                    <span className={s.state}>{t(`state.invoice.${invoice.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>}

          <Fields client={client} items={evidence.data?.items ?? []} hidden={hidden} problems={problems} onDismiss={(itemId) => void dismiss(itemId)} foldTax={!registered} />
          <ClientCrm key={`crm-${client.id}`} clientId={client.id} addDetails={<>
            <div className={s.formActions}><Button size="sm" onClick={(event) => openSheet('proposal', `client:${client.id}`, event.currentTarget)}>{t('kit-sales.proposal.open')}</Button></div>
            {brandKit.data?.version === null && <BrandKit clientId={client.id} files={theirMedia} />}
          </>} />

          {brandKit.error && <div><p role="alert">{brandKit.error.message}</p><Button disabled={brandKit.loading} onClick={brandKit.reload}>{t('status.retry')}</Button></div>}
          {brandKit.data?.version != null && <BrandKit clientId={client.id} files={theirMedia} />}

          {theirDrafts.length > 0 && (
            <section aria-labelledby={draftsId}>
              <h3 id={draftsId} className={s.heading}>{t('clients.drafts')}</h3>
              <ul className={s.items} aria-labelledby={draftsId}>
                {theirDrafts.map((draft) => (
                  <li key={draft.id} className={s.item}>
                    <span className={s.itemText}>{draft.deliverable?.title ?? t('clients.draft.untitled', { request: requestOf.get(draft.orderId) ?? '' })}</span>{' '}
                    <span className={s.state}>{t(`clients.draft.${draft.status}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {theirFiles.length > 0 && (
            <section aria-labelledby={filesId}>
              <h3 id={filesId} className={s.heading}>{t('clients.files')}</h3>
              <ul className={s.items} aria-labelledby={filesId}>
                {theirFiles.map((file) => (
                  <li key={file.id} className={s.item}>
                    <span data-code="" className={`${s.itemText} mono`}>{file.name}</span>{' '}
                    <span className={s.format}>{file.format.toUpperCase()}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

type Draft = { name: string; phone: string; email: string; taxId: string; note: string };
type Problem = { field?: 'taxId'; message: string };

/** Add client: venture.client.add with only what was typed. The engine checks every field and says what is wrong.
 *  A business not registered for GST finds the tax number under "More details", opened for it when the engine
 *  refuses the number there. */
function NewClientSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const registered = useTaxRegistered();
  const [draft, setDraft] = useState<Draft>({ name: '', phone: '', email: '', taxId: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [more, setMore] = useState(false);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !draft.name.trim()) return;
    const params: ClientAddParams = { name: draft.name.trim() };
    // One-shot C6: the number as typed; the engine works out the WhatsApp digits, or says what is wrong.
    if (draft.phone.trim()) params.phone = draft.phone.trim();
    if (draft.email.trim()) params.email = draft.email.trim();
    if (draft.taxId.trim()) params.taxId = draft.taxId.trim();
    if (draft.note.trim()) params.note = draft.note.trim();
    setBusy(true);
    setProblem(null);
    try {
      const created = await engine.request('venture.client.add', params);
      clientsChanged(engine);
      openSheet('client', created.id, document.querySelector<HTMLElement>('[data-add-client]'));
    } catch (error) {
      const code = error instanceof EngineError ? error.code : 'REQUEST_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      setProblem(code === 'INVALID_TAX_ID' ? { field: 'taxId', message } : { message });
      if (code === 'INVALID_TAX_ID') setMore(true);
      setBusy(false);
    }
  }

  const taxField = (
    <Field label={t('clients.new.taxId')} value={draft.taxId} onChange={set('taxId')} autoComplete="off" maxLength={60} error={problem?.field === 'taxId' ? problem.message : undefined} />
  );

  return (
    <Sheet label={t('clients.sheet')} title={t('clients.new.title')} line={t('clients.new.line')} onClose={onClose} returnFocus={returnFocus}>
      <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('clients.new.name')} value={draft.name} onChange={set('name')} autoComplete="off" required maxLength={120} />
        <Field label={t('clients.new.phone')} type="tel" inputMode="tel" value={draft.phone} onChange={set('phone')} autoComplete="off" maxLength={40} />
        <Field label={t('clients.new.email')} type="email" value={draft.email} onChange={set('email')} autoComplete="off" maxLength={200} />
        {registered && taxField}
        <Field multiline label={t('clients.new.note')} value={draft.note} onChange={set('note')} maxLength={500} />
        {!registered && <MoreDetails open={more} onOpenChange={setMore}>{taxField}</MoreDetails>}
        {problem && !problem.field && <p className={s.failed} role="alert">{t('clients.new.failed', { message: problem.message })}</p>}
        <div className={s.formActions}>
          <Button onClick={onClose}>{t('clients.new.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || !draft.name.trim()}>{busy ? t('clients.new.saving') : t('clients.new.submit')}</Button>
        </div>
      </form>
    </Sheet>
  );
}
