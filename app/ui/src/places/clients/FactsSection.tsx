/**
 * W6 6G4 (D44): what Chausar remembers about the business or one client, as dated facts (venture.memory.*). Each current
 * fact shows its topic, its words (quoted: the owner's, or an AI's labelled "From AI"), since when it is true, where it
 * came from and who may see it. Replace keeps the old fact under "Earlier facts", marked replaced; "Let my AI read it" and
 * "Only me" set who may see it; Forget asks once more, then erases the words of every version. Nothing is computed here:
 * every word and day comes from the engine.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { FactView, FactVisibility } from '../../engine/types';
import { useDay, useLocalToday } from '../money/words';
import { CrmFold, messageOf } from './CrmParts';
import s from './Crm.module.css';
import { Select } from '../../parts/Select';
import { clientsChanged, useClientsChanged } from './signals';

/** The facts with their heading, for a sheet. */
export function FactsSection({ subject, quiet = false }: { subject: string; quiet?: boolean }) {
  const t = useT();
  const id = useId();
  const engine = useEngine();
  const view = useResource('venture.memory.list', { subject });
  useClientsChanged(engine, view.reload);
  if (quiet && !view.error && !view.data?.facts.length && !view.data?.earlier.some(fact => !fact.erased)) return null;
  return (
    <section aria-labelledby={id} data-facts={subject}>
      <h3 id={id} className={s.heading}>{t('crm.facts')}</h3>
      <FactsBody subject={subject} quiet={quiet} />
    </section>
  );
}

/** The facts without a heading, for a page that gives its own (Business > What the AI knows). */
export function FactsBody({ subject, quiet = false }: { subject: string; quiet?: boolean }) {
  const t = useT();
  const day = useDay();
  const view = useResource('venture.memory.list', { subject });
  const engine = useEngine();
  useClientsChanged(engine, view.reload);
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const done = (line: string) => { setSaid({ line, problem: false }); view.reload(); clientsChanged(engine); };
  const failed = (error: unknown) => setSaid({ line: messageOf(error), problem: true });

  if (view.error) return <p className={s.failed} role="alert">{messageOf(view.error)}</p>;
  if (!view.data) return null;
  const { facts } = view.data;
  const earlier = quiet ? view.data.earlier.filter(fact => !fact.erased) : view.data.earlier;
  return (
    <>
      {!quiet && <p className={s.quiet}>{view.data.line}</p>}
      {said && <p className={said.problem ? s.failed : s.said} role={said.problem ? 'alert' : 'status'}>{said.line}</p>}
      {facts.length === 0 ? <p className={s.quiet}>{t('crm.facts.none')}</p> : (
        <ul className={s.items}>
          {facts.map((fact) => <FactRow key={fact.id} fact={fact} onDone={done} onFailed={failed} />)}
        </ul>
      )}
      {!quiet && <CrmFold summary={t('crm.facts.add')}><AddFact subject={subject} onDone={done} onFailed={failed} /></CrmFold>}
      {earlier.length > 0 && (
        <CrmFold summary={t('crm.facts.earlier')}>
          <ul className={s.items} data-earlier="">
            {earlier.map((fact) => (
              <li key={fact.id} className={s.item}>
                <span className={s.line}>
                  {fact.topic && <>{fact.topic}{': '}</>}<span data-content="" className={s.words}>{fact.text}</span>
                </span>
                <span className={s.when}>
                  {t('crm.facts.since', { day: day(fact.since) })}
                  {fact.replacedAt && <>{', '}{t('crm.facts.replacedOn', { day: day(fact.replacedAt) })}</>}
                </span>
              </li>
            ))}
          </ul>
        </CrmFold>
      )}
    </>
  );
}

function FactRow({ fact, onDone, onFailed }: { fact: FactView; onDone: (line: string) => void; onFailed: (error: unknown) => void }) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const localToday = useLocalToday();
  const [mode, setMode] = useState<'rest' | 'replace' | 'forget'>('rest');
  const [text, setText] = useState(fact.text);
  const [since, setSince] = useState(localToday());
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<{ line: string }>) {
    setBusy(true);
    try { const answer = await work(); setMode('rest'); onDone(answer.line); } catch (error) { onFailed(error); } finally { setBusy(false); }
  }
  const visibility = (next: FactVisibility) => run(() => engine.request('venture.memory.visibility', { factId: fact.id, visibility: next }));
  const replace = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    void run(() => engine.request('venture.memory.replace', { factId: fact.id, text: text.trim(), since }));
  };

  return (
    <li className={s.item} data-fact={fact.id}>
      <span className={s.line}>
        {fact.topic}{': '}<span data-content="" className={s.words}>{fact.text}</span>
        {fact.source === 'ai' && <>{' '}<span className={s.tag}>{t('crm.facts.fromAi')}</span></>}
      </span>
      <span className={s.when}>{t('crm.facts.since', { day: day(fact.since) })}</span>
      <span className={s.quiet}>{fact.sourceLine} {fact.visibilityLine}</span>
      {mode === 'rest' && (
        <span className={s.row}>
          <Button size="sm" onClick={() => setMode('replace')}>{t('crm.facts.replace')}</Button>
          <Button size="sm" disabled={busy} onClick={() => void visibility(fact.visibility === 'ai' ? 'owner' : 'ai')}>
            {t(fact.visibility === 'ai' ? 'crm.facts.hideAi' : 'crm.facts.showAi')}
          </Button>
          <Button size="sm" onClick={() => setMode('forget')}>{t('crm.facts.forget')}</Button>
        </span>
      )}
      {mode === 'replace' && (
        <form className={s.form} onSubmit={replace}>
          <Field multiline label={t('crm.facts.replaceWith')} value={text} maxLength={600} onChange={(event) => setText(event.currentTarget.value)} />
          <Field label={t('crm.facts.sinceLabel')} type="date" value={since} min={fact.since} max={localToday()} onChange={(event) => setSince(event.currentTarget.value)} />
          <div className={s.actions}>
            <Button onClick={() => setMode('rest')}>{t('crm.facts.cancel')}</Button>
            <Button type="submit" disabled={busy || !text.trim()}>{t('crm.facts.replaceSave')}</Button>
          </div>
        </form>
      )}
      {mode === 'forget' && (
        <span className={s.form}>
          <span className={s.quiet}>{t('crm.facts.forgetAsk')}</span>
          <span className={s.actions}>
            <Button onClick={() => setMode('rest')}>{t('crm.facts.cancel')}</Button>
            <Button disabled={busy} onClick={() => void run(() => engine.request('venture.memory.forget', { factId: fact.id }))}>{t('crm.facts.forgetYes')}</Button>
          </span>
        </span>
      )}
    </li>
  );
}

export function AddFact({ subject, onDone, onFailed, textLabel }: { subject: string; onDone: (line: string) => void; onFailed: (error: unknown) => void; textLabel?: string }) {
  const t = useT();
  const engine = useEngine();
  const ids = useId();
  const localToday = useLocalToday();
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [since, setSince] = useState(localToday());
  const [who, setWho] = useState<FactVisibility>('ai');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !topic.trim() || !text.trim()) return;
    setBusy(true);
    try {
      const answer = await engine.request('venture.memory.add', { subject, topic: topic.trim(), text: text.trim(), since, visibility: who });
      setTopic(''); setText('');
      onDone(answer.line);
    } catch (error) { onFailed(error); } finally { setBusy(false); }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <Field label={t('crm.facts.topic')} value={topic} maxLength={60} autoComplete="off" onChange={(event) => setTopic(event.currentTarget.value)} />
      <Field multiline label={textLabel ?? t('crm.facts.text')} value={text} maxLength={600} onChange={(event) => setText(event.currentTarget.value)} />
      <Field label={t('crm.facts.sinceLabel')} type="date" value={since} max={localToday()} onChange={(event) => setSince(event.currentTarget.value)} />
      <div className={s.choice}>
        <label className={s.label} htmlFor={`${ids}-who`}>{t('crm.facts.who')}</label>
        <Select id={`${ids}-who`} className={s.select} value={who} onChange={(event) => setWho(event.currentTarget.value as FactVisibility)}>
          <option value="ai">{t('crm.facts.who.ai')}</option>
          <option value="owner">{t('crm.facts.who.owner')}</option>
        </Select>
      </div>
      <div className={s.actions}><Button type="submit" disabled={busy} disabledReason={!topic.trim() || !text.trim() ? t('crm.facts.needBoth') : undefined}>{t('crm.facts.keep')}</Button></div>
    </form>
  );
}
