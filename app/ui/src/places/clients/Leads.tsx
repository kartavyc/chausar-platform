/**
 * Leads (#/clients/leads, spec section 7.9): people the owner may write to. A lead needs the page it was found on;
 * an email counts once a mail server answered for it; agents only draft, and the owner sends from his own mailbox,
 * then says so here. Every draft carries the business name, the owner's postal address and an unsubscribe line,
 * added by the engine and shown as it wrote them. A blocked address is never drafted to again.
 *
 * Sheets: `lead:new` adds a lead, `lead:<id>` shows one with its drafts, sends and the block.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Row } from '../../parts/Row';
import { Sheet } from '../../parts/Sheet';
import { EngineError, type LeadView, type OutreachDraftView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { clientsChanged, useClientsChanged } from './signals';
import s from './Clients.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const codeOf = (error: unknown) => (error instanceof EngineError ? error.code : 'REQUEST_FAILED');

/** The leads list. The list is what the engine sends, newest first. */
export function Leads() {
  const t = useT();
  const engine = useEngine();
  const leads = useResource('venture.leads.list', {});
  useClientsChanged(engine, () => leads.reload());
  const list = leads.data?.leads ?? [];

  return (
    <section aria-label={t('clients.sub.leads')}>
      {leads.error && <p className={s.failed} role="alert">{t('sheet.failed', { message: leads.error.message })}</p>}
      {leads.data && list.length === 0 && <EmptyState title={t('clients.leads.empty')} />}
      {list.length > 0 && (
        <ul className={s.list} aria-label={t('clients.sub.leads')}>
          {list.map((lead) => <LeadRow key={lead.id} lead={lead} />)}
        </ul>
      )}
    </section>
  );
}

/** The add button for the page head. */
export function AddLead() {
  const t = useT();
  return <Button data-add-lead="" onClick={(event) => openSheet('lead', 'new', event.currentTarget)}>{t('clients.leads.add')}</Button>;
}

function LeadRow({ lead }: { lead: LeadView }) {
  const t = useT();
  return (
    <Row
      id={lead.id}
      eyebrow={lead.company ?? undefined}
      title={lead.name}
      onOpen={(origin) => openSheet('lead', lead.id, origin)}
      line={
        <span className={s.lineText}>
          {lead.email ? <>{lead.email} · {t(`clients.leads.check.${lead.emailCheck.status}`)}</> : t('clients.leads.noEmail')}
        </span>
      }
      actions={<span className={s.state}>{t(`clients.leads.status.${lead.status}`)}</span>}
    >
      <span className={`${s.source} mono`}>{lead.sourceUrl}</span>
    </Row>
  );
}

export function LeadSheet(props: SheetComponentProps) {
  return props.id === 'new' ? <NewLeadSheet {...props} /> : <ExistingLeadSheet {...props} />;
}

type NewLead = { name: string; company: string; email: string; sourceUrl: string };

/** Add a lead: venture.leads.add with what was typed. The engine refuses a lead without the page it was found on. */
function NewLeadSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const [draft, setDraft] = useState<NewLead>({ name: '', company: '', email: '', sourceUrl: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field?: 'sourceUrl'; message: string } | null>(null);
  const set = (key: keyof NewLead) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));
  const ready = draft.name.trim() !== '' && draft.sourceUrl.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    const params: { name: string; company?: string; email?: string; sourceUrl: string } = { name: draft.name.trim(), sourceUrl: draft.sourceUrl.trim() };
    if (draft.company.trim()) params.company = draft.company.trim();
    if (draft.email.trim()) params.email = draft.email.trim();
    setBusy(true);
    setProblem(null);
    try {
      const lead = await engine.request('venture.leads.add', params);
      clientsChanged(engine);
      openSheet('lead', lead.id, document.querySelector<HTMLElement>('[data-add-lead]'));
    } catch (error) {
      setProblem(codeOf(error) === 'LEADS_SOURCE_REQUIRED' ? { field: 'sourceUrl', message: messageOf(error) } : { message: messageOf(error) });
      setBusy(false);
    }
  }

  return (
    <Sheet label={t('clients.leads.sheet')} title={t('clients.leads.new.title')} line={t('clients.leads.new.line')} onClose={onClose} returnFocus={returnFocus}>
      <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('clients.leads.new.name')} value={draft.name} onChange={set('name')} autoComplete="off" required maxLength={120} />
        <Field label={t('clients.leads.new.company')} value={draft.company} onChange={set('company')} autoComplete="off" maxLength={120} />
        <Field label={t('clients.leads.new.email')} type="email" value={draft.email} onChange={set('email')} autoComplete="off" maxLength={200} />
        <Field
          label={t('clients.leads.new.source')} type="url" value={draft.sourceUrl} onChange={set('sourceUrl')} autoComplete="off" required maxLength={500}
          hint={t('clients.leads.new.sourceHint')} error={problem?.field === 'sourceUrl' ? problem.message : undefined}
        />
        {problem && !problem.field && <p className={s.failed} role="alert">{t('clients.leads.failed', { message: problem.message })}</p>}
        <div className={s.formActions}>
          <Button onClick={onClose}>{t('clients.new.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>{busy ? t('clients.new.saving') : t('clients.leads.new.submit')}</Button>
        </div>
      </form>
    </Sheet>
  );
}

function ExistingLeadSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const draftsId = useId();
  const leads = useResource('venture.leads.list', {});
  useClientsChanged(engine, () => leads.reload());
  const lead = leads.data?.leads.find((l) => l.id === id);
  const title = leads.error ? t('sheet.failed', { message: leads.error.message })
    : !leads.data ? t('sheet.loading')
      : lead ? lead.name : t('clients.leads.notFound');

  return (
    <Sheet label={t('clients.leads.sheet')} title={title} line={lead?.company ?? undefined} onClose={onClose} returnFocus={returnFocus}>
      {lead && (
        <>
          <dl className={s.facts}>
            <div className={s.fact}>
              <dt>{t('clients.leads.foundOn')}</dt>
              <dd className="mono">{lead.sourceUrl}</dd>
            </div>
            <div className={s.fact}>
              <dt>{t('clients.field.email')}</dt>
              <dd>
                {lead.email ?? t('clients.leads.noEmail')}
                <span className={s.factNote}>{lead.emailCheck.line}</span>
              </dd>
            </div>
            <div className={s.fact}>
              <dt>{t('clients.leads.state')}</dt>
              <dd>{t(`clients.leads.status.${lead.status}`)}</dd>
            </div>
          </dl>

          {lead.drafts.length > 0 && (
            <section aria-labelledby={draftsId}>
              <h3 id={draftsId} className={s.heading}>{t('clients.leads.drafts')}</h3>
              <ul className={s.items} aria-labelledby={draftsId}>
                {lead.drafts.map((draft) => <DraftItem key={draft.id} lead={lead} draft={draft} />)}
              </ul>
            </section>
          )}

          {lead.status !== 'blocked' && <DraftForm lead={lead} />}
          {lead.status !== 'blocked' && lead.email && <Block lead={lead} email={lead.email} />}
        </>
      )}
    </Sheet>
  );
}

/** One draft as the engine wrote it, with the lines it adds at the foot, and the owner's own send. */
function DraftItem({ lead, draft }: { lead: LeadView; draft: OutreachDraftView }) {
  const t = useT();
  const sent = lead.sends.find((send) => send.draftId === draft.id);
  return (
    <li className={s.draft}>
      <span className={s.draftTo}>{t('clients.leads.to', { to: draft.to })}</span>
      <span className={s.draftSubject}>{draft.subject}</span>
      <span className={s.draftText}>{draft.text}</span>
      <span className={s.footer}>
        <span>{draft.footer.businessName}</span>
        <span>{draft.footer.postalAddress}</span>
        <span>{draft.footer.unsubscribe}</span>
      </span>
      {sent ? <span className={s.state}>{t('clients.leads.sentOn', { when: sent.sentAt.slice(0, 16).replace('T', ' ') })}</span> : <RecordSend lead={lead} draft={draft} />}
    </li>
  );
}

/** "Now" for a datetime-local field, in this computer's time. Text work only. */
function nowLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The owner sent this draft from his own mailbox: he says when, and the engine records it. Chausar never sends it. */
function RecordSend({ lead, draft }: { lead: LeadView; draft: OutreachDraftView }) {
  const t = useT();
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(nowLocal);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function record() {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) { setProblem(t('clients.leads.sendWhenBad')); return; }
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.leads.recordSend', { leadId: lead.id, draftId: draft.id, sentAt: at.toISOString() });
      clientsChanged(engine);
    } catch (error) {
      setProblem(messageOf(error));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className={s.sendLine}>
        <span className={s.quiet}>{t('clients.leads.youSend')}</span>
        <Button variant="quiet" onClick={() => setOpen(true)}>{t('clients.leads.iSent')}</Button>
      </span>
    );
  }
  return (
    <span className={s.inlineForm}>
      <Field label={t('clients.leads.sendWhen')} type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
      {problem && <span className={s.failed} role="alert">{t('clients.leads.failed', { message: problem })}</span>}
      <span className={s.formActions}>
        <Button onClick={() => { setOpen(false); setProblem(null); }}>{t('clients.new.cancel')}</Button>
        <Button variant="primary" disabled={busy || !when} onClick={() => void record()}>{t('clients.leads.record')}</Button>
      </span>
    </span>
  );
}

/** Draft an email. The engine adds the business name, postal address and unsubscribe line, and asks for the address once. */
function DraftForm({ lead }: { lead: LeadView }) {
  const t = useT();
  const engine = useEngine();
  const formId = useId();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [address, setAddress] = useState('');
  const [asksAddress, setAsksAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = subject.trim() !== '' && body.trim() !== '' && (!asksAddress || address.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.leads.draft', { leadId: lead.id, subject: subject.trim(), body: body.trim(), ...(address.trim() ? { postalAddress: address.trim() } : {}) });
      setSubject('');
      setBody('');
      setAsksAddress(false);
      setBusy(false);
      clientsChanged(engine);
    } catch (error) {
      if (codeOf(error) === 'LEADS_ADDRESS_MISSING') setAsksAddress(true);
      setProblem(messageOf(error));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={formId}>
      <h3 id={formId} className={s.heading}>{t('clients.leads.draftTitle')}</h3>
      <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t('clients.leads.subject')} value={subject} onChange={(event) => setSubject(event.target.value)} autoComplete="off" maxLength={150} />
        <Field multiline label={t('clients.leads.message')} value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={5000} />
        {asksAddress && (
          <Field label={t('clients.leads.address')} hint={t('clients.leads.addressHint')} value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="off" maxLength={300} />
        )}
        <p className={s.quiet}>{t('clients.leads.draftNote')}</p>
        {problem && <p className={s.failed} role="alert">{t('clients.leads.failed', { message: problem })}</p>}
        <div className={s.formActions}>
          <Button variant="primary" type="submit" disabled={busy || !ready}>{busy ? t('clients.leads.drafting') : t('clients.leads.draft')}</Button>
        </div>
      </form>
    </section>
  );
}

/** Block this address or its whole domain. Asks once more before it goes to the engine. */
function Block({ lead, email }: { lead: LeadView; email: string }) {
  const t = useT();
  const engine = useEngine();
  const name = useId();
  const domain = lead.emailDomain ?? email.split('@')[1] ?? '';
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState(email);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.leads.block', { value });
      clientsChanged(engine);
    } catch (error) {
      setProblem(messageOf(error));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <p className={s.blockLine}>
        <Button variant="quiet" className={s.dismiss} onClick={() => setAsking(true)}>{t('clients.leads.block')}</Button>
      </p>
    );
  }
  return (
    <fieldset className={s.ask2}>
      <legend className={s.heading}>{t('clients.leads.blockAsk')}</legend>
      <label className={s.choice}>
        <input type="radio" name={name} checked={value === email} onChange={() => setValue(email)} />
        <span>{t('clients.leads.blockEmail', { email })}</span>
      </label>
      {domain && (
        <label className={s.choice}>
          <input type="radio" name={name} checked={value === domain} onChange={() => setValue(domain)} />
          <span>{t('clients.leads.blockDomain', { domain })}</span>
        </label>
      )}
      {problem && <p className={s.failed} role="alert">{t('clients.leads.failed', { message: problem })}</p>}
      <div className={s.formActions}>
        <Button onClick={() => { setAsking(false); setProblem(null); }}>{t('clients.new.cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void block()}>{t('clients.leads.blockConfirm')}</Button>
      </div>
    </fieldset>
  );
}
