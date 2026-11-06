import { useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { AgentView, PersonaFields, VentureRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { AgentFile } from './AgentFile';
import s from './AgentExtras.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** The agent says each new persona version in its chat, so a message is when the persona may have changed. */
const PERSONA_EVENTS = (event: VentureRunEvent) => event.type === 'agent.message';
const LENGTHS = ['short', 'medium', 'long'] as const;

/** The form as typed: every field words, the topics one a line. */
interface Form { tone: string; replyLength: '' | (typeof LENGTHS)[number]; greeting: string; handOffLine: string; blockedTopics: string; signOff: string }
const formOf = (persona: PersonaFields): Form => ({
  tone: persona.tone ?? '', replyLength: persona.replyLength ?? '', greeting: persona.greeting ?? '', handOffLine: persona.handOffLine ?? '',
  blockedTopics: persona.blockedTopics.join('\n'), signOff: persona.signOff ?? '',
});
/** What is sent, exactly as typed: an empty field is null, the topics are the lines that have words. */
const personaOf = (form: Form): PersonaFields => {
  const one = (text: string) => (text.trim() ? text.trim() : null);
  return {
    tone: one(form.tone), replyLength: form.replyLength || null, greeting: one(form.greeting), handOffLine: one(form.handOffLine),
    blockedTopics: form.blockedTopics.split('\n').map((line) => line.trim()).filter(Boolean), signOff: one(form.signOff),
  };
};

type Asking = { persona: PersonaFields } | null;
type Tried = { results: { scenario: string; reply: string }[]; cost: string; line: string } | null;

/**
 * How it talks, a closed fold in the agent panel's Instructions (W4 4J22b, from 4J17's persona.ts; catalogue A9), after
 * Chausar's fixed rules (tone, reply length, greeting, hand-off line, topics it stays away from, sign-off). Its role in
 * the playbook stays apart. Test tries the unsaved persona on the business's practice clients (made-up clients, no
 * client data) and shows each first reply and what that cost, saving nothing. Save is the owner's approval: it asks
 * once more, then the engine keeps it as a new version from the agent's next run; the version before stays, and "Go
 * back" sets the one the engine's view gives as undo, after the same second yes. A field the engine refuses (a
 * number, a change to the rules or the facts) keeps the words and shows its rule. The agent file sits under it.
 */
export function AgentPersona({ agent }: { agent: AgentView }) {
  const t = useT();
  const engine = useEngine();
  const resultsId = useId();
  const headId = useId();
  const view = useResource('venture.persona.get', { agent: agent.id }, { refreshOn: PERSONA_EVENTS });
  const [form, setForm] = useState<Form | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [tried, setTried] = useState<Tried>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = view.data?.version;
  // The form takes the persona in use when it arrives and whenever its version changes; typing in between is kept.
  useEffect(() => { if (view.data) setForm(formOf(view.data.persona)); }, [version, agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A closed fold in Instructions at rest (the tab stays simple); its summary names the section.
  const fold = (body: ReactNode) => (
    <details className={s.fold}>
      <summary className={s.foldSummary}><span id={headId}>{t('team.persona.title')}</span></summary>
      {body}
    </details>
  );
  if (view.error) return fold(<p className={s.problem} role="alert">{messageOf(view.error)}</p>);
  if (!view.data || !form) return fold(<p className={s.quiet}>{t('team.loading')}</p>);
  const data = view.data;
  // A change to any field makes an earlier test's replies stale, so they go.
  const edit = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setAsking(null); setTried(null); };
  // Nothing to save while the fields say what is in use.
  const unchanged = JSON.stringify(personaOf(form)) === JSON.stringify(data.persona);

  async function test() {
    setBusy(true);
    setProblem(null);
    try {
      setTried(await engine.request('venture.persona.test', { agent: agent.id, persona: personaOf(form!) }));
    } catch (error) {
      setTried(null);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function save(persona: PersonaFields) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const saved = await engine.request('venture.persona.set', { agent: agent.id, persona });
      setAsking(null);
      setSaid(saved.line);
      setForm(formOf(saved.persona));
      view.reload();
    } catch (error) {
      setAsking(null);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const field = (name: 'tone' | 'greeting' | 'handOffLine' | 'signOff', label: string) => (
    <Field label={label} value={form[name]} onChange={(event) => edit({ [name]: event.currentTarget.value })} />
  );

  return fold(
    <section className={s.tab} aria-labelledby={headId}>
      <p className={s.line}>{data.line}</p>
      <div className={s.form}>
        {field('tone', t('team.persona.tone'))}
        <div className={s.selectField}>
          <label className={s.label} htmlFor={`${resultsId}-length`}>{t('team.persona.length')}</label>
          <select id={`${resultsId}-length`} className={s.select} value={form.replyLength} onChange={(event) => edit({ replyLength: event.currentTarget.value as Form['replyLength'] })}>
            <option value="">{t('team.persona.lengthNone')}</option>
            {LENGTHS.map((length) => <option key={length} value={length}>{t(`team.persona.length.${length}`)}</option>)}
          </select>
        </div>
        {field('greeting', t('team.persona.greeting'))}
        {field('handOffLine', t('team.persona.handOff'))}
        <Field multiline label={t('team.persona.topics')} hint={t('team.persona.topicsHint')} value={form.blockedTopics} rows={3} onChange={(event) => edit({ blockedTopics: event.currentTarget.value })} />
        {field('signOff', t('team.persona.signOff'))}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {said && <p className={s.said} role="status">{said}</p>}
      {asking ? (
        <div className={s.ask} data-second-ask="">
          <p className={s.askLine}>{t('team.persona.ask', { name: agent.name })}</p>
          <div className={s.buttons}>
            <Button size="sm" disabled={busy} onClick={() => setAsking(null)}>{t('team.persona.notNow')}</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void save(asking.persona)}>{t('team.persona.yes')}</Button>
          </div>
        </div>
      ) : (
        <div className={s.buttons}>
          {data.undo && (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => setAsking({ persona: data.undo! })}>
              {t('team.persona.back', { version: String((data.version ?? 1) - 1) })}
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => void test()}>{t('team.persona.test')}</Button>
          <Button size="sm" variant="primary" disabled={busy} locked={unchanged} lockedReason={t('team.persona.unchanged')} onClick={() => { if (!unchanged) setAsking({ persona: personaOf(form) }); }}>{t('team.persona.save')}</Button>
        </div>
      )}
      {tried && (
        <section className={s.section} aria-labelledby={resultsId}>
          <h3 id={resultsId} className={s.small}>{t('team.persona.results')}</h3>
          <ul className={s.results} aria-labelledby={resultsId}>
            {tried.results.map((result) => (
              <li key={result.scenario} className={s.result}>
                <p className={s.scenario}>{result.scenario}</p>
                <p className={s.reply} data-content="">{result.reply}</p>
              </li>
            ))}
          </ul>
          {/* The engine sends the test's cost as words with no receipt: shown as the engine wrote it, never as a figure. */}
          <p className={s.quiet} data-persona-cost="" data-engine-line="">{t('team.persona.cost', { cost: tried.cost })}</p>
          <p className={s.quiet}>{tried.line}</p>
        </section>
      )}
      <AgentFile agent={agent} />
    </section>
  );
}
