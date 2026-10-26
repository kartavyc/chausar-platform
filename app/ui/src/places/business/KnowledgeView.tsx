import { useId, useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { KnowledgeSourceInput, KnowledgeSourceView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { TileSection, dayOf, messageOf } from './shared';
import b from './Business.module.css';
import s from './KnowledgeView.module.css';

type Kind = KnowledgeSourceInput['kind'];
const KINDS: readonly Kind[] = ['text', 'link', 'file', 'past-work'];
type Tested = { hits: { sourceId: string; title: string; line: string }[]; line: string } | null;

/**
 * Business > What the AI knows (W4 4J22b, from 4J18's knowledge.ts; catalogue A10). Sources: each with where it came
 * from and when, in the engine's words, which also say what the screen hid, why a held one is held (agents never read
 * the parts that hold it) and when Forget erased words from it; a file or accepted work keeps no client's name. The
 * engine's line says who reads them: only the sources that share words with an order's request. Remove asks once more,
 * then the source and its words go. Add a source: the owner's own words, a web page, a file already on an order, or
 * work the owner accepted, each screened by the engine (words aimed at an agent are refused and nothing is kept). Test
 * a question: which sources share words with it, by code, no model. Files the agents need: the questions agents
 * handed to the owner that no source answers, a line a month.
 */
export function KnowledgeView() {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.knowledge.list', {});
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = view.data;

  async function remove(source: KnowledgeSourceView) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await engine.request('venture.knowledge.remove', { id: source.id });
      setSaid(answer.line);
      setAsking(null);
      view.reload();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  if (view.error) return <p className={b.problem} role="alert">{messageOf(view.error)}</p>;
  if (!data) return <p className={b.note}>{t('business.loading')}</p>;
  return (
    <div className={b.page}>
      <div className={b.split}>
        <TileSection title={t('business.knowledge.sources')} meta={data.sources.length ? t('business.knowledge.count', { count: data.sources.length }) : undefined}>
          <p className={b.line}>{data.line}</p>
          {said && <p className={b.said} role="status">{said}</p>}
          {problem && <p className={b.problem} role="alert">{problem}</p>}
          {data.sources.length === 0 ? <p className={b.note}>{t('business.knowledge.none')}</p> : (
            <ul className={s.sources}>
              {data.sources.map((source) => (
                <Source
                  key={source.id}
                  source={source}
                  asking={asking === source.id}
                  busy={busy}
                  onAsk={() => { setAsking(source.id); setSaid(null); }}
                  onNo={() => setAsking(null)}
                  onYes={() => void remove(source)}
                />
              ))}
            </ul>
          )}
        </TileSection>
        <div className={b.column}>
          <AddSource onAdded={(line) => { setSaid(line); view.reload(); }} />
          <TestQuestion />
          {data.requests.length > 0 && (
            <TileSection title={t('business.knowledge.requests')}>
              <ul className={s.requests}>
                {data.requests.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </TileSection>
          )}
        </div>
      </div>
    </div>
  );
}

/** One source: its kind, its title, the engine's line about it, and Remove with its second ask. */
function Source({ source, asking, busy, onAsk, onNo, onYes }: {
  source: KnowledgeSourceView; asking: boolean; busy: boolean; onAsk: () => void; onNo: () => void; onYes: () => void;
}) {
  const t = useT();
  const titleId = useId();
  return (
    <li className={s.source} aria-labelledby={titleId}>
      <div className={s.sourceHead}>
        <Chip tone="line">{t(`business.knowledge.kind.${source.kind}`)}</Chip>
        <span id={titleId} className={s.title} data-source-title="" data-content="">{source.title}</span>
      </div>
      <p className={s.sourceLine}>{source.line}</p>
      {asking ? (
        <div className={s.ask} data-second-ask="">
          <p className={s.askLine}>{t('business.knowledge.removeAsk')}</p>
          <div className={s.buttons}>
            <Button size="sm" disabled={busy} onClick={onNo}>{t('business.knowledge.notNow')}</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={onYes}>{t('business.knowledge.removeYes')}</Button>
          </div>
        </div>
      ) : (
        <div className={s.buttons}>
          <Button size="sm" variant="quiet" onClick={onAsk}>{t('business.knowledge.remove')}</Button>
        </div>
      )}
    </li>
  );
}

/** Add a source of one of four kinds; the engine reads and screens it, and refuses what it will not keep. */
function AddSource({ onAdded }: { onAdded: (line: string) => void }) {
  const t = useT();
  const language = useLanguage();
  const engine = useEngine();
  const name = useId();
  const [kind, setKind] = useState<Kind>('text');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [pick, setPick] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = useResource('venture.files.list', {}, { skip: kind !== 'file' });
  const runs = useResource('venture.delivery.list', {}, { skip: kind !== 'past-work' });
  const fileChoices = (files.data ?? []).filter((file) => file.scope.kind === 'order');
  const workChoices = (runs.data ?? []).filter((run) => !run.practice && (run.status === 'accepted' || run.status === 'edited'));

  const input = (): KnowledgeSourceInput | null => {
    if (kind === 'text') return title.trim() && text.trim() ? { kind, title: title.trim(), text: text.trim() } : null;
    if (kind === 'link') return url.trim() ? { kind, url: url.trim() } : null;
    if (kind === 'file') return pick ? { kind, uploadId: pick } : null;
    return pick ? { kind, runId: pick } : null;
  };
  const ready = input();

  async function add(event: FormEvent) {
    event.preventDefault();
    const source = input();
    if (!source) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await engine.request('venture.knowledge.add', { source });
      setTitle('');
      setText('');
      setUrl('');
      setPick('');
      onAdded(t('business.knowledge.added', { title: answer.source.title }));
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('business.knowledge.add')}>
      <form className={s.form} onSubmit={(event) => void add(event)}>
        <fieldset className={s.kinds}>
          <legend className="sr-only">{t('business.knowledge.kindLabel')}</legend>
          {KINDS.map((one) => (
            <label key={one} className={s.kind}>
              <input type="radio" name={name} value={one} checked={kind === one} onChange={() => { setKind(one); setPick(''); setProblem(null); }} />
              <span>{t(`business.knowledge.kind.${one}`)}</span>
            </label>
          ))}
        </fieldset>
        {kind === 'text' && (
          <>
            <Field label={t('business.knowledge.title')} value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            <Field multiline rows={4} label={t('business.knowledge.text')} value={text} onChange={(event) => setText(event.currentTarget.value)} />
          </>
        )}
        {kind === 'link' && <Field label={t('business.knowledge.url')} hint={t('business.knowledge.urlHint')} value={url} inputMode="url" onChange={(event) => setUrl(event.currentTarget.value)} />}
        {kind === 'file' && (
          <Choice label={t('business.knowledge.file')} none={t('business.knowledge.noFiles')} value={pick} onChange={setPick} options={fileChoices.map((file) => ({ id: file.id, label: file.name }))} loaded={Boolean(files.data)} />
        )}
        {kind === 'past-work' && (
          <Choice label={t('business.knowledge.work')} none={t('business.knowledge.noWork')} value={pick} onChange={setPick} options={workChoices.map((run) => ({ id: run.id, label: run.deliverable?.title ?? t('business.knowledge.workOn', { day: dayOf(run.verdict?.at ?? run.at, language) }) }))} loaded={Boolean(runs.data)} />
        )}
        {kind === 'past-work' && <p className={b.note}>{t('business.knowledge.workNote')}</p>}
        {problem && <p className={b.problem} role="alert">{problem}</p>}
        <div className={s.buttons}>
          <Button size="sm" variant="primary" type="submit" disabled={busy || !ready}>{t('business.knowledge.addButton')}</Button>
        </div>
      </form>
    </TileSection>
  );
}

/** A list to pick from (a file on an order, or accepted work), or one sentence when there is nothing to pick. */
function Choice({ label, none, value, onChange, options, loaded }: {
  label: string; none: string; value: string; onChange: (id: string) => void; options: { id: string; label: string }[]; loaded: boolean;
}) {
  const t = useT();
  const id = useId();
  if (!loaded) return <p className={b.note}>{t('business.loading')}</p>;
  if (options.length === 0) return <p className={b.note}>{none}</p>;
  return (
    <div className={s.choice}>
      <label className={s.label} htmlFor={id}>{label}</label>
      <select id={id} className={s.select} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">{t('business.knowledge.choose')}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  );
}

/** Test a question: the sources that share words with it, the most first, each with its sentence; by code, no model. */
function TestQuestion() {
  const t = useT();
  const engine = useEngine();
  const listId = useId();
  const [question, setQuestion] = useState('');
  const [tested, setTested] = useState<Tested>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function test(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      setTested(await engine.request('venture.knowledge.test', { question: question.trim() }));
    } catch (error) {
      setTested(null);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('business.knowledge.test')}>
      <form className={s.form} onSubmit={(event) => void test(event)}>
        <Field label={t('business.knowledge.question')} value={question} onChange={(event) => setQuestion(event.currentTarget.value)} />
        <div className={s.buttons}>
          <Button size="sm" type="submit" disabled={busy || !question.trim()}>{t('business.knowledge.testButton')}</Button>
        </div>
      </form>
      {problem && <p className={b.problem} role="alert">{problem}</p>}
      {tested && (
        <>
          <p className={b.said}>{tested.line}</p>
          {tested.hits.length > 0 && (
            <>
              <p id={listId} className="sr-only">{t('business.knowledge.hits')}</p>
              <ul className={s.hits} aria-labelledby={listId}>
                {tested.hits.map((hit) => (
                  <li key={hit.sourceId} className={s.hit}>
                    <span className={s.title} data-content="">{hit.title}</span>
                    <span className={s.sourceLine} data-content="">{hit.line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </TileSection>
  );
}
