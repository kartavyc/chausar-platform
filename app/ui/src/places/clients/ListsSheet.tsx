/**
 * W6 6G3 (D44): pipelines as lists. `?sheet=lists:all` lists the owner's lists (each opens its own sheet) and makes a new
 * one: a name and two to eight stages, one per line. `?sheet=list:<id>` shows one list as its stages in order, who sits
 * at each (a client, person or company opens its own sheet) with a stage picker to move them or take them out, "Add to
 * this list", its changes, and its name and stages to change. The main pipeline keeps its board and its rules; nothing in
 * a list is ever sent. Every line comes from the engine.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { CrmListView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { Fold, HistoryList, messageOf } from './CrmParts';
import s from './Crm.module.css';

const stagesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

export function ListsSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const lists = useResource('venture.crm.lists', {});
  const [name, setName] = useState('');
  const [stages, setStages] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function make(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await engine.request('venture.crm.list.save', { name: name.trim(), stages: stagesOf(stages) });
      setName(''); setStages('');
      lists.reload();
      openSheet('list', made.list.id, document.activeElement);
    } catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }

  return (
    <Sheet label={t('crm.lists.sheet')} title={t('crm.lists.sheet')} onClose={onClose} returnFocus={returnFocus}>
      {lists.error && <p className={s.failed} role="alert">{messageOf(lists.error)}</p>}
      {lists.data && (lists.data.length === 0 ? <p className={s.quiet}>{t('crm.lists.empty')}</p> : (
        <ul className={s.items}>
          {lists.data.map((list) => (
            <li key={list.id} className={s.item}>
              <button type="button" className={s.link} onClick={(event) => openSheet('list', list.id, event.currentTarget)}>{list.name}</button>
              <span className={s.when}>{t('crm.lists.count', { count: String(list.count) })}</span>
            </li>
          ))}
        </ul>
      ))}
      <Fold summary={t('crm.lists.new')}>
        <form className={s.form} onSubmit={(event) => void make(event)}>
          <Field label={t('crm.lists.name')} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />
          <Field multiline label={t('crm.lists.stages')} value={stages} rows={4} onChange={(event) => setStages(event.currentTarget.value)} />
          {problem && <p className={s.failed} role="alert">{problem}</p>}
          <div className={s.actions}><Button type="submit" disabled={busy || !name.trim()}>{t('crm.lists.make')}</Button></div>
        </form>
      </Fold>
    </Sheet>
  );
}

export function ListSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const view = useResource('venture.crm.list', { listId: id });
  const [data, setData] = useState<CrmListView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = data ?? view.data ?? null;
  const title = view.error ? t('crm.lists.notFound') : shown ? shown.list.name : t('sheet.loading');
  const changed = (next: CrmListView) => { setData(next); setProblem(null); view.reload(); };
  return (
    <Sheet label={t('crm.lists.sheet')} title={title} onClose={onClose} returnFocus={returnFocus}>
      {shown && (
        <>
          <p className={s.quiet}>{shown.line}</p>
          {problem && <p className={s.failed} role="alert">{problem}</p>}
          {shown.groups.map((group) => <StageGroup key={group.stage} view={shown} stage={group.stage} onChanged={changed} onFailed={(error) => setProblem(messageOf(error))} />)}
          <Fold summary={t('crm.lists.addMember')}><AddMember view={shown} onChanged={changed} onFailed={(error) => setProblem(messageOf(error))} /></Fold>
          <Fold summary={t('crm.history')}><HistoryList rows={shown.history} /></Fold>
          <Fold summary={t('crm.lists.rename')}><RenameList view={shown} onChanged={changed} onFailed={(error) => setProblem(messageOf(error))} /></Fold>
        </>
      )}
    </Sheet>
  );
}

function StageGroup({ view, stage, onChanged, onFailed }: { view: CrmListView; stage: string; onChanged: (next: CrmListView) => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const headingId = useId();
  const group = view.groups.find((item) => item.stage === stage)!;
  async function move(member: string, next: string) {
    try { onChanged(await engine.request('venture.crm.list.place', { listId: view.list.id, member, stage: next === '' ? null : next })); } catch (error) { onFailed(error); }
  }
  return (
    <section aria-labelledby={headingId} data-stage={stage}>
      <h3 id={headingId} className={s.heading}>{stage}</h3>
      {group.entries.length === 0 ? <p className={s.quiet}>{t('crm.lists.nothing')}</p> : (
        <ul className={s.items}>
          {group.entries.map((entry) => (
            <li key={entry.member} className={s.item}>
              <button type="button" className={s.link} onClick={(event) => openSheet(entry.kind, entry.member.slice(entry.member.indexOf(':') + 1), event.currentTarget)}>{entry.name}</button>
              <select aria-label={t('crm.lists.move', { name: entry.name })} className={s.select} value={stage} onChange={(event) => void move(entry.member, event.currentTarget.value)}>
                {view.list.stages.map((one) => <option key={one} value={one}>{one}</option>)}
                <option value="">{t('crm.lists.out')}</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddMember({ view, onChanged, onFailed }: { view: CrmListView; onChanged: (next: CrmListView) => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const clients = useResource('venture.client.list', {});
  const companies = useResource('venture.crm.companies', {});
  const [member, setMember] = useState('');
  const [stage, setStage] = useState(view.list.stages[0] ?? '');
  const inside = new Set(view.groups.flatMap((group) => group.entries.map((entry) => entry.member)));
  const options = [
    ...(clients.data ?? []).filter((client) => !client.self).map((client) => ({ value: `client:${client.id}`, label: client.name })),
    ...(companies.data ?? []).map((company) => ({ value: `company:${company.id}`, label: company.name })),
  ].filter((option) => !inside.has(option.value));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!member || !stage) return;
    try { onChanged(await engine.request('venture.crm.list.place', { listId: view.list.id, member, stage })); setMember(''); } catch (error) { onFailed(error); }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-member`}>{t('crm.lists.member')}</label>
        <select id={`${ids}-member`} className={s.select} value={member} onChange={(event) => setMember(event.currentTarget.value)}>
          <option value="" disabled>{t('crm.lists.member')}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-stage`}>{t('crm.lists.stage')}</label>
        <select id={`${ids}-stage`} className={s.select} value={stage} onChange={(event) => setStage(event.currentTarget.value)}>
          {view.list.stages.map((one) => <option key={one} value={one}>{one}</option>)}
        </select>
      </div>
      <div className={s.actions}><Button type="submit" disabled={!member || !stage}>{t('crm.lists.place')}</Button></div>
    </form>
  );
}

function RenameList({ view, onChanged, onFailed }: { view: CrmListView; onChanged: (next: CrmListView) => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const engine = useEngine();
  const [name, setName] = useState(view.list.name);
  const [stages, setStages] = useState(view.list.stages.join('\n'));
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { onChanged(await engine.request('venture.crm.list.save', { listId: view.list.id, name: name.trim(), stages: stagesOf(stages) })); } catch (error) { onFailed(error); }
  }
  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <Field label={t('crm.lists.name')} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />
      <Field multiline label={t('crm.lists.stages')} value={stages} rows={4} onChange={(event) => setStages(event.currentTarget.value)} />
      <div className={s.actions}><Button type="submit" disabled={!name.trim()}>{t('crm.lists.saveList')}</Button></div>
    </form>
  );
}
