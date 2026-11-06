import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * W6 6G3 (D44): the company sheet (`?sheet=company:<id>`). The company's name and website, its clients (each opens the
 * client sheet) and people (each opens the person sheet): the other side of the link the client and person sheets show.
 * Then its clients' timelines together, newest first; its changes, folded; and its details to change, folded. Every
 * line comes from the engine.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { CompanyView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { CrmFold, HistoryList, TimelineList } from './CrmParts';
import s from './Crm.module.css';

export function CompanySheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const membersId = useId();
  const timelineId = useId();
  const view = useResource('venture.crm.company', { companyId: id });
  const company = view.data?.company;
  const title = view.error ? t('crm.company.notFound') : company ? company.name : t('sheet.loading');
  return (
    <Sheet label={t('crm.company.sheet')} title={title} loading={!view.data && !view.error} line={company?.domain ?? undefined} onClose={onClose} returnFocus={returnFocus}>
      {view.data && (
        <>
          {view.data.company.note && <p className={s.quiet} data-content="">{view.data.company.note}</p>}
          <section aria-labelledby={membersId}>
            <h3 id={membersId} className={s.heading}>{t('crm.company.members')}</h3>
            <Members view={view.data} />
          </section>
          <section aria-labelledby={timelineId}>
            <h3 id={timelineId} className={s.heading}>{t('crm.timeline')}</h3>
            <TimelineList entries={view.data.timeline} names={new Map(view.data.clients.map((client) => [client.id, client.name]))} />
          </section>
          <CrmFold summary={t('crm.history')}><HistoryList rows={view.data.history} /></CrmFold>
          <CrmFold summary={t('crm.edit.open')}><CompanyForm view={view.data} onSaved={() => view.reload()} /></CrmFold>
        </>
      )}
    </Sheet>
  );
}

function Members({ view }: { view: CompanyView }) {
  const t = useT();
  if (!view.clients.length && !view.people.length) return <p className={s.quiet}>{t('crm.company.noMembers')}</p>;
  const rows = [
    ...view.clients.map((client) => ({ key: `client:${client.id}`, kind: 'client', id: client.id, name: client.name, tag: t('crm.company.clients') })),
    ...view.people.map((person) => ({ key: `person:${person.id}`, kind: 'person', id: person.id, name: person.name, tag: t('crm.company.people') })),
  ];
  return (
    <ul className={s.items}>
      {rows.map((row) => (
        <li key={row.key} className={s.item}>
          <button type="button" className={s.link} onClick={(event) => openSheet(row.kind, row.id, event.currentTarget)}>{row.name}</button>
          <span className={s.tag}>{row.tag}</span>
        </li>
      ))}
    </ul>
  );
}

function CompanyForm({ view, onSaved }: { view: CompanyView; onSaved: () => void }) {
  const t = useT();
  const engine = useEngine();
  const [name, setName] = useState(view.company.name);
  const [domain, setDomain] = useState(view.company.domain ?? '');
  const [note, setNote] = useState(view.company.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    const params: { companyId: string; name?: string; domain?: string | null; note?: string | null } = { companyId: view.company.id };
    if (name.trim() !== view.company.name) params.name = name.trim();
    if ((domain.trim() || null) !== view.company.domain) params.domain = domain.trim() || null;
    if ((note.trim() || null) !== view.company.note) params.note = note.trim() || null;
    setBusy(true);
    setProblem(null);
    try { await engine.request('venture.crm.company.save', params); onSaved(); } catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <Field label={t('crm.company.name')} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />
      <Field label={t('crm.company.domain')} value={domain} maxLength={200} autoComplete="off" onChange={(event) => setDomain(event.currentTarget.value)} />
      <Field multiline label={t('crm.company.note')} value={note} maxLength={500} onChange={(event) => setNote(event.currentTarget.value)} />
      {problem && <p className={s.failed} role="alert">{problem}</p>}
      <div className={s.actions}><Button type="submit" disabled={busy || !name.trim()}>{t('crm.company.save')}</Button></div>
    </form>
  );
}
