import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * W6 6G3 and 6G4 (D44): the CRM parts of the client sheet, under the client's fields. Company: the company the client is
 * in (opens the company sheet), or "Put in a company" (an existing one or a new one). Timeline: what the owner logged,
 * the sends and replies on the client's pipeline cards and the client's invoices, newest first, with "Log a call or
 * message" folded (the owner logs WhatsApp messages and calls; Chausar has no WhatsApp connection). Lists: the owner's
 * lists the client sits in, at which stage, and "Put in a list". What Chausar remembers: the client's dated facts.
 * Changes: the field history, folded. Change details: a new name, email or note, through the engine's ledger. Every
 * line and day comes from the engine; nothing is added up here.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { ClientCrmView, CrmEntryKind } from '../../engine/types';
import { useLocalToday } from '../money/words';
import { CrmFold, HistoryList, TimelineList } from './CrmParts';
import { FactsSection } from './FactsSection';
import { clientsChanged } from './signals';
import s from './Crm.module.css';
import { Select } from '../../parts/Select';

const KINDS: readonly CrmEntryKind[] = ['call', 'whatsapp', 'meeting', 'note'];

export function ClientCrm({ clientId }: { clientId: string }) {
  const t = useT();
  const companyId = useId();
  const timelineId = useId();
  const listsId = useId();
  const crm = useResource('venture.crm.client', { clientId });
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const failed = (error: unknown) => setSaid({ line: messageOf(error), problem: true });
  const changed = () => { setSaid(null); crm.reload(); };

  if (crm.error) return <p className={s.failed} role="alert">{messageOf(crm.error)}</p>;
  if (!crm.data) return null;
  const view = crm.data;
  return (
    <>
      {said && <p className={said.problem ? s.failed : s.said} role={said.problem ? 'alert' : 'status'}>{said.line}</p>}
      <section aria-labelledby={companyId} data-crm-company="">
        <h3 id={companyId} className={s.heading}>{t('crm.company')}</h3>
        <CompanyLine view={view} onChanged={changed} onFailed={failed} />
      </section>

      <section aria-labelledby={timelineId}>
        <h3 id={timelineId} className={s.heading}>{t('crm.timeline')}</h3>
        <TimelineList entries={view.timeline} />
        <CrmFold summary={t('crm.log.open')}><LogForm clientId={clientId} onChanged={changed} onFailed={failed} /></CrmFold>
      </section>

      <section aria-labelledby={listsId}>
        <h3 id={listsId} className={s.heading}>{t('crm.lists')}</h3>
        {view.lists.length === 0 ? <p className={s.quiet}>{t('crm.lists.none')}</p> : (
          <ul className={s.items}>
            {view.lists.map((place) => (
              <li key={place.listId} className={s.item}>
                <button type="button" className={s.link} onClick={(event) => openSheet('list', place.listId, event.currentTarget)}>{place.name}</button>
                <span className={s.when}>{place.stage}</span>
              </li>
            ))}
          </ul>
        )}
        <CrmFold summary={t('crm.lists.add')}><PlaceInList member={`client:${clientId}`} onChanged={changed} onFailed={failed} /></CrmFold>
      </section>

      <FactsSection subject={`client:${clientId}`} />

      <CrmFold summary={t('crm.history')}><HistoryList rows={view.history} /></CrmFold>
      <CrmFold summary={t('crm.edit.open')}><EditForm clientId={clientId} onChanged={changed} onFailed={failed} /></CrmFold>
    </>
  );
}

function CompanyLine({ view, onChanged, onFailed }: { view: ClientCrmView; onChanged: () => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const companies = useResource('venture.crm.companies', {});
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const member = `client:${view.clientId}`;

  async function link(companyId: string | null) {
    setBusy(true);
    try { await engine.request('venture.crm.link', { companyId, member }); companies.reload(); onChanged(); } catch (error) { onFailed(error); } finally { setBusy(false); }
  }
  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (pick !== 'new') { if (pick) await link(pick); return; }
    if (!name.trim()) return;
    setBusy(true);
    try {
      const made = await engine.request('venture.crm.company.save', { name: name.trim() });
      await engine.request('venture.crm.link', { companyId: made.company.id, member });
      setName(''); setPick('');
      companies.reload(); onChanged();
    } catch (error) { onFailed(error); } finally { setBusy(false); }
  }

  if (view.company) {
    return (
      <p className={s.row}>
        <button type="button" className={s.link} onClick={(event) => openSheet('company', view.company!.id, event.currentTarget)}>{view.company.name}</button>
        <Button size="sm" disabled={busy} onClick={() => void link(null)}>{t('crm.company.leave')}</Button>
      </p>
    );
  }
  return (
    <>
      <p className={s.quiet}>{t('crm.company.none')}</p>
      <CrmFold summary={t('crm.company.pick')}>
        <form className={s.form} onSubmit={(event) => void join(event)}>
          <div className={s.choice}>
            <label className={s.label} htmlFor={`${ids}-company`}>{t('crm.company.choose')}</label>
            <Select id={`${ids}-company`} className={s.select} value={pick} onChange={(event) => setPick(event.currentTarget.value)}>
              <option value="" disabled>{t('crm.company.choose')}</option>
              {(companies.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              <option value="new">{t('crm.company.new')}</option>
            </Select>
          </div>
          {pick === 'new' && <Field label={t('crm.company.newName')} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />}
          <div className={s.actions}><Button type="submit" disabled={busy || !pick || (pick === 'new' && !name.trim())}>{t('crm.company.join')}</Button></div>
        </form>
      </CrmFold>
    </>
  );
}

function LogForm({ clientId, onChanged, onFailed }: { clientId: string; onChanged: () => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const localToday = useLocalToday();
  const [kind, setKind] = useState<CrmEntryKind>('call');
  const [on, setOn] = useState(localToday());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    try { await engine.request('venture.crm.log', { clientId, kind, on, text: text.trim() }); setText(''); onChanged(); } catch (error) { onFailed(error); } finally { setBusy(false); }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <p className={s.quiet}>{t('crm.log.line')}</p>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-kind`}>{t('crm.log.kind')}</label>
        <Select id={`${ids}-kind`} className={s.select} value={kind} onChange={(event) => setKind(event.currentTarget.value as CrmEntryKind)}>
          {KINDS.map((one) => <option key={one} value={one}>{t(`crm.log.kind.${one}`)}</option>)}
        </Select>
      </div>
      <Field label={t('crm.log.on')} type="date" value={on} max={localToday()} onChange={(event) => setOn(event.currentTarget.value)} />
      <Field multiline label={t('crm.log.text')} value={text} maxLength={1000} onChange={(event) => setText(event.currentTarget.value)} />
      <div className={s.actions}><Button type="submit" disabled={busy || !text.trim()}>{t('crm.log.save')}</Button></div>
    </form>
  );
}

/** Put a client, person or company in one of the owner's lists, at one of its stages. */
export function PlaceInList({ member, onChanged, onFailed }: { member: string; onChanged: () => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const lists = useResource('venture.crm.lists', {});
  const [listId, setListId] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (lists.data ?? []).find((item) => item.id === listId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !listId || !stage) return;
    setBusy(true);
    try { await engine.request('venture.crm.list.place', { listId, member, stage }); lists.reload(); onChanged(); } catch (error) { onFailed(error); } finally { setBusy(false); }
  }

  if (lists.data && lists.data.length === 0) {
    return <p className={s.row}><span className={s.quiet}>{t('crm.lists.empty')}</span><Button size="sm" onClick={(event) => openSheet('lists', 'all', event.currentTarget)}>{t('crm.lists.new')}</Button></p>;
  }
  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-list`}>{t('crm.lists.list')}</label>
        <Select id={`${ids}-list`} className={s.select} value={listId} onChange={(event) => { setListId(event.currentTarget.value); setStage(''); }}>
          <option value="" disabled>{t('crm.lists.list')}</option>
          {(lists.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </div>
      {list && (
        <div className={s.choice}>
          <label className={s.label} htmlFor={`${ids}-stage`}>{t('crm.lists.stage')}</label>
          <Select id={`${ids}-stage`} className={s.select} value={stage} onChange={(event) => setStage(event.currentTarget.value)}>
            <option value="" disabled>{t('crm.lists.stage')}</option>
            {list.stages.map((one) => <option key={one} value={one}>{one}</option>)}
          </Select>
        </div>
      )}
      <div className={s.actions}><Button type="submit" disabled={busy || !listId || !stage}>{t('crm.lists.place')}</Button></div>
    </form>
  );
}

function EditForm({ clientId, onChanged, onFailed }: { clientId: string; onChanged: () => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const [field, setField] = useState<'name' | 'phone' | 'email' | 'note'>('note');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !value.trim()) return;
    setBusy(true);
    try {
      await engine.request('venture.crm.client.edit', { clientId, field, value: value.trim() });
      setValue('');
      clientsChanged(engine);
      onChanged();
    } catch (error) { onFailed(error); } finally { setBusy(false); }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-field`}>{t('crm.edit.field')}</label>
        <Select id={`${ids}-field`} className={s.select} value={field} onChange={(event) => setField(event.currentTarget.value as 'name' | 'phone' | 'email' | 'note')}>
          {(['name', 'phone', 'email', 'note'] as const).map((one) => <option key={one} value={one}>{t(`crm.edit.field.${one}`)}</option>)}
        </Select>
      </div>
      {field === 'note'
        ? <Field multiline label={t('crm.edit.value')} value={value} maxLength={500} onChange={(event) => setValue(event.currentTarget.value)} />
        : <Field label={t('crm.edit.value')} value={value} maxLength={field === 'email' ? 200 : field === 'phone' ? 40 : 120} autoComplete="off" onChange={(event) => setValue(event.currentTarget.value)} />}
      <div className={s.actions}><Button type="submit" disabled={busy || !value.trim()}>{t('crm.edit.save')}</Button></div>
    </form>
  );
}

