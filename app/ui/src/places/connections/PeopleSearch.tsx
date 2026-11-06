/**
 * Connections, "People search" (wave 6, 6F8; the engine's people/services.ts). Happenstance (your own network) and
 * Probe42 (Indian company records) each run on the owner's own key, saved in this computer's protected storage; each
 * says "fixture-tested, needs your key" until it has run on a real account. Tofler is planned, with the manual path.
 * A lookup shows the exact words and cost first; nothing is sent until "Approve and look up". Answers come from the
 * service, so they sit in [data-content]. Nothing here ever opens or asks LinkedIn.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { PeopleLookupView } from '../../engine/types';
import { codeWords } from './KitConnect';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

type Keyed = 'happenstance' | 'probe42';

export function PeopleSearch() {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.people.services', {});
  const [keys, setKeys] = useState<Partial<Record<Keyed, string>>>({});
  const [service, setService] = useState<Keyed>('happenstance');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<PeopleLookupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try { await work(); } catch (error) { setProblem(codeWords(error, t)); } finally { setBusy(false); }
  }
  const saveKey = (id: Keyed, key: string | null) => run(async () => {
    try { await engine.request('venture.people.services', { service: id, key }); view.reload(); }
    finally { setKeys((current) => ({ ...current, [id]: '' })); }
  });
  const show = (chosen: Keyed) => run(async () => { setAnswer(await engine.request('venture.people.lookup', { service: chosen, query: query.trim() })); });
  const approve = (chosen: Keyed, digest: string) => run(async () => { setAnswer(await engine.request('venture.people.lookup', { service: chosen, query: query.trim(), digest })); });
  const again = (searchId: string) => run(async () => { setAnswer(await engine.request('venture.people.lookup', { service: 'happenstance', searchId })); });

  const data = view.data;
  const ready = data?.services.filter((item): item is typeof item & { id: Keyed } => item.saved !== null && item.id !== 'tofler') ?? [];
  // The service asked: the one picked if its key is saved, else the first with a key.
  const current: Keyed = ready.some((item) => item.id === service) ? service : ready[0]?.id ?? service;
  return (
    <div role="region" aria-label={t('web-people.people.title')} className={s.card} data-people-search="">
      {data && <p className={s.quiet}>{data.line}</p>}
      {data && (
        <ul className={k.list}>
          {data.services.map((item) => (
            <li key={item.id} className={k.item} data-people-service={item.id}>
              <div className={k.itemHead}>
                <span className={k.name}>{item.name}</span>
                <span className={k.small}>{item.needs}</span>
              </div>
              <p className={k.small}>{item.covers}</p>
              {item.planned && <p className={k.small}>{t('web-people.people.meanwhile', { text: item.planned.meanwhile })}</p>}
              {item.id !== 'tofler' && item.saved && (
                <div className={s.actions}>
                  <span className={k.small}>{t('web-people.people.saved', { hint: item.saved.keyHint })}</span>
                  <Button size="sm" variant="quiet" disabled={busy} onClick={() => void saveKey(item.id as Keyed, null)}>{t('web-people.people.remove')}</Button>
                </div>
              )}
              {item.id !== 'tofler' && !item.saved && (
                <>
                  <Field
                    label={t('web-people.people.key', { name: item.name })} type="password" autoComplete="off" spellCheck={false}
                    value={keys[item.id as Keyed] ?? ''} disabled={busy} onChange={(event) => { const value = event.currentTarget.value; setKeys((current) => ({ ...current, [item.id]: value })); }}
                  />
                  <div className={s.actions}><Button size="sm" disabled={busy || !(keys[item.id as Keyed] ?? '').trim()} onClick={() => void saveKey(item.id as Keyed, (keys[item.id as Keyed] ?? '').trim())}>{t('web-people.people.save')}</Button></div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <div className={s.form} data-people-lookup="">
          <fieldset className={k.kinds}>
            <legend>{t('web-people.lookup.service')}</legend>
            {ready.map((item) => (
              <label key={item.id}>
                <input type="radio" name="people-service" value={item.id} checked={current === item.id} onChange={() => { setService(item.id); setAnswer(null); }} />
                {item.name}
              </label>
            ))}
          </fieldset>
          <Field label={t('web-people.lookup.query')} hint={t('web-people.lookup.queryHint')} autoComplete="off" value={query} disabled={busy} onChange={(event) => { setQuery(event.currentTarget.value); setAnswer(null); }} />
          <div className={s.actions}><Button size="sm" disabled={busy || query.trim().length < 2} onClick={() => void show(current)}>{t('web-people.lookup.show')}</Button></div>
        </div>
      )}
      {answer?.state === 'quote' && answer.quote && (
        <div className={k.item} data-people-quote="">
          <p className={s.said}>{answer.quote.line}</p>
          <div className={s.actions}><Button variant="primary" disabled={busy} onClick={() => void approve(answer.service, answer.quote!.digest)}>{t('web-people.lookup.approve')}</Button></div>
        </div>
      )}
      {answer && answer.state !== 'quote' && (
        <div className={k.item} data-people-answer={answer.state}>
          <p className={s.said}>{answer.line}</p>
          {answer.state === 'running' && answer.searchId && <div className={s.actions}><Button size="sm" disabled={busy} onClick={() => void again(answer.searchId!)}>{t('web-people.lookup.again')}</Button></div>}
          {(answer.people?.length || answer.companies?.length) ? <p className={k.small}>{answer.label}</p> : null}
          {answer.people?.map((person) => (
            <p key={person.url} className={k.content} data-content="">
              {person.name}{person.title ? `, ${person.title}` : ''}{person.company ? `, ${person.company}` : ''}. {person.summary ?? ''} {t('web-people.lookup.mutuals', { count: person.mutuals })}
            </p>
          ))}
          {answer.companies?.map((company) => (
            <p key={company.id} className={k.content} data-content="">
              {company.name}, {company.id}{company.status ? `, ${company.status}` : ''}{company.formed ? `, ${company.formed}` : ''}{company.state ? `, ${company.state}` : ''}
            </p>
          ))}
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
