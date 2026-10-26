/**
 * The Network tab (#/clients/network; spec 5.5, the direction D board D-Network, modelled on Happenstance): the owner's
 * own network from their own files, searched in plain words. It opens on the search (starters that fill the box and
 * never send; "Also look outside my network" only where a web search is set up, else a line saying so), with the
 * results under it and everyone by name one step away (Browse everyone, a page at a time). On the right: where the
 * network comes from, how well the owner knows them, and what stays private (NetworkSources.tsx).
 *
 * Everything shown is the engine's: the summary line, the traits, each result's "Why" with the file words it quotes,
 * its checks, its strength (worked out in code, with its receipt) and its warm path, with "possible path, not
 * confirmed" where the engine cannot confirm one. The UI words only the engine's codes: whether a web search is set
 * up, a protected trait, a missing AI. A search sends the owner's words to their own AI only after the chat consent:
 * when a search is refused for it, the consent the people view carries is read once and shown, and Agree sends that
 * same digest. Chausar never writes to the people: Add to pipeline starts a card at Found; drafts and handoffs are the
 * pipeline's (4E4). Someone forgotten from the person sheet leaves the results at once.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource, type Resource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Chip } from '../../parts/Chip';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { StrengthDots } from '../../parts/StrengthDots';
import { Tile, TileHead } from '../../parts/Tile';
import type { NetworkSearchView, NetworkSourcesView, PeopleView, PipelineStage, SearchResultView } from '../../engine/types';
import { ExternalLink } from '../connections/external';
import { clientsChanged, useClientsChanged } from './signals';
import { NetworkSources } from './NetworkSources';
import { NetworkDrafts } from './NetworkDrafts';
import { codeOf, dotsOf, LinkedInButton, messageOf, networkRefresh, quoted, roleLine, usePersonForgotten, WarmPath } from './network';
import s from './Network.module.css';

/** How many people Browse everyone shows at a time. */
const PAGE = 8;
/** How long the filter waits after the last key before it asks the engine. */
const FILTER_WAIT_MS = 300;

const STARTERS = [
  { label: 'clients.network.starter.quiet', fill: 'clients.network.starter.quiet' },
  { label: 'clients.network.starter.intro', fill: 'clients.network.starter.intro' },
  { label: 'clients.network.starter.brief', fill: 'clients.network.starter.brief.fill' },
] as const;

type Search =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; view: NetworkSearchView; results: SearchResultView[] }
  | { kind: 'consent'; text: string; digest: string | null; problem: string | null }
  | { kind: 'refused'; code: string; message: string };

/** `count`: the people view with limit 0, read for the tab's count; it says how many there are and nothing else. */
export function NetworkTab({ count }: { count: Resource<PeopleView> }) {
  const t = useT();
  const engine = useEngine();
  const sources = useResource('venture.network.sources', {}, { refreshOn: networkRefresh });
  const [search, setSearch] = useState<Search>({ kind: 'idle' });
  const [browsing, setBrowsing] = useState(false);
  useClientsChanged(engine, () => sources.reload());
  // Someone forgotten leaves the results at once.
  usePersonForgotten(engine, (id) => setSearch((now) => (now.kind === 'done' ? { ...now, results: now.results.filter((result) => result.person?.id !== id) } : now)));

  if (count.error) return <p className={s.problem} role="alert">{t('sheet.failed', { message: count.error.message })}</p>;
  if (!count.data || (!sources.data && !sources.error)) return null;
  const empty = count.data.total === 0 && (sources.data?.sources.length ?? 0) === 0;
  if (empty) {
    return (
      <EmptyState
        title={t('clients.network.empty')}
        line={t('clients.network.empty.line')}
        action={<Button variant="primary" onClick={(event) => openSheet('network-import', 'new', event.currentTarget)}><Icon name="upload" size={16} />{t('clients.network.import')}</Button>}
      />
    );
  }
  return (
    <div className={s.frame}>
      <div className={s.layout}>
        <div className={s.main}>
          <SearchTile search={search} setSearch={setSearch} webSearch={sources.data?.webSearch ?? 'not-set-up'} />
          {search.kind === 'done' && <Results search={search} setSearch={setSearch} />}
          {browsing ? <Everyone /> : count.data.total > 0 && (
            <div className={s.browse}>
              <Button variant="quiet" onClick={() => setBrowsing(true)}><Icon name="users" size={16} />{t('clients.network.browse', { count: String(count.data.total) })}</Button>
            </div>
          )}
        </div>
        <div className={s.side}>
          {sources.error && <p className={s.problem} role="alert">{t('sheet.failed', { message: sources.error.message })}</p>}
          {sources.data && <NetworkSources view={sources.data} />}
        </div>
      </div>
    </div>
  );
}

/** The search tile: the box, Search, the web choice (or the line that no web search is set up), and the starters. */
function SearchTile({ search, setSearch, webSearch }: { search: Search; setSearch: (next: Search) => void; webSearch: NetworkSourcesView['webSearch'] }) {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const boxId = useId();
  const [text, setText] = useState('');
  const [web, setWeb] = useState(false);
  const askWeb = webSearch === 'set-up' && web;

  async function run(words = text) {
    if (words.trim().length < 2) return;
    setSearch({ kind: 'busy' });
    try {
      const view = await engine.request('venture.network.search', { text: words.trim(), web: askWeb });
      setSearch({ kind: 'done', view, results: view.results });
    } catch (error) {
      const code = codeOf(error);
      if (code === 'CHAT_CONSENT_REQUIRED' || code === 'CHAT_CONSENT_STALE') await askConsent(error);
      else setSearch({ kind: 'refused', code, message: messageOf(error) });
    }
  }

  /**
   * The consent is one per business, shared by agent chat, Chats and this search. It is read once, now, from the people
   * view: the owner reads that text, and Agree sends that same digest, so a consent that changes meanwhile is refused
   * as stale rather than agreed to unseen.
   */
  async function askConsent(refusal: unknown) {
    try {
      const { consent } = await engine.request('venture.network.people', { limit: 0 });
      if (consent) setSearch({ kind: 'consent', text: consent.text ?? '', digest: consent.digest, problem: null });
      else setSearch({ kind: 'refused', code: codeOf(refusal), message: messageOf(refusal) });
    } catch (error) {
      setSearch({ kind: 'refused', code: codeOf(error), message: messageOf(error) });
    }
  }

  async function agree(consent: Extract<Search, { kind: 'consent' }>) {
    try {
      if (consent.digest) await engine.request('venture.chats.consent', { digest: consent.digest });
      await run();
    } catch (error) {
      setSearch({ ...consent, problem: t('clients.network.consent.failed', { message: messageOf(error) }) });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run();
  }

  return (
    <Tile as="section" labelledBy={titleId} className={s.search}>
      <TileHead id={titleId} title={t('clients.network.search.title')} />
      <form className={s.query} role="search" onSubmit={submit}>
        <div className={s.box}>
          <Icon name="search" size={18} />
          <label className="sr-only" htmlFor={boxId}>{t('clients.network.search.label')}</label>
          <input id={boxId} type="search" className={s.input} value={text} placeholder={t('clients.network.search.label')} onChange={(event) => setText(event.target.value)} autoComplete="off" />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={search.kind === 'busy'}>{search.kind === 'busy' ? t('clients.network.search.busy') : t('clients.network.search.go')}</Button>
      </form>
      {webSearch === 'set-up' ? (
        <div className={s.option}>
          <label className={s.check}>
            <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />
            {t('clients.network.web')}
          </label>
          <span className={s.meta}>{t('clients.network.web.line')}</span>
        </div>
      ) : <p className={s.meta}>{t('clients.network.web.notSetUp')}</p>}
      <div className={s.starters}>
        <span className={s.meta}>{t('clients.network.try')}</span>
        {STARTERS.map((starter) => (
          <button key={starter.label} type="button" className={s.starter} onClick={() => setText(t(starter.fill))}>{t(starter.label)}</button>
        ))}
      </div>
      {search.kind === 'consent' && (
        <Inner card={false} className={s.consent}>
          <p className={s.consentTitle}>{t('clients.network.consent.title')}</p>
          <p className={s.consentText}>{search.text}</p>
          <div className={s.actions}><Button size="sm" onClick={() => void agree(search)}>{t('clients.network.consent.agree')}</Button></div>
          {search.problem && <p className={s.problem} role="alert">{search.problem}</p>}
        </Inner>
      )}
      {search.kind === 'refused' && <Refusal code={search.code} message={search.message} />}
    </Tile>
  );
}

/** A search the engine refused: a protected trait (a quiet note) and a missing AI in the UI's words, anything else in the engine's. */
function Refusal({ code, message }: { code: string; message: string }) {
  const t = useT();
  if (code === 'NETWORK_TRAIT_PROTECTED') return <p className={s.note} role="status">{t('clients.network.protected')}</p>;
  if (code === 'NO_MODEL_CONNECTED') {
    return <p className={s.problem} role="alert">{t('clients.network.noAi')} <a className={s.link} href="#/connections/ai">{t('clients.network.connectAi')}</a></p>;
  }
  return <p className={s.problem} role="alert">{t('clients.network.failed', { message })}</p>;
}

/** The engine's summary as D's head: the count ("6 people fit") as the heading, the rest of its sentence beside it. */
function splitSummary(summary: string): [string, string] {
  const at = summary.indexOf('. ');
  return at < 0 ? [summary.replace(/\.$/, ''), ''] : [summary.slice(0, at), summary.slice(at + 2)];
}

function Results({ search, setSearch }: { search: Extract<Search, { kind: 'done' }>; setSearch: (next: Search) => void }) {
  const t = useT();
  const engine = useEngine();
  const headId = useId();
  const tracesId = useId();
  const { view, results } = search;
  const [more, setMore] = useState(view.more);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [head, rest] = splitSummary(view.summary);

  async function findMore() {
    setBusy(true);
    setProblem(null);
    try {
      const next = await engine.request('venture.network.searchMore', { searchId: view.id });
      setSearch({ kind: 'done', view: { ...view, more: next.more }, results: [...results, ...next.results] });
      setMore(next.more);
    } catch (error) {
      setProblem(t('clients.network.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saving?.trim()) return;
    setProblem(null);
    try {
      const { search: kept } = await engine.request('venture.network.saveSearch', { searchId: view.id, name: saving.trim() });
      setSaved(kept.name);
      setSaving(null);
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    }
  }

  const webWords = view.web === 'not-set-up' || view.web === 'failed' || view.web === 'none' ? t(`clients.network.webState.${view.web}`)
    : view.web === 'skipped' || view.web === 'found' ? view.webLine : null;

  return (
    <section className={s.results} aria-labelledby={headId}>
      <div className={s.resultsHead}>
        <h2 id={headId} className={s.resultsTitle}>{head}</h2>
        {rest && <span className={s.meta}>{rest}</span>}
        {saving === null && !saved && <Button size="sm" className={s.end} onClick={() => setSaving(view.text.slice(0, 60))}><Icon name="tag" size={14} />{t('clients.network.save')}</Button>}
      </div>
      {saving !== null && (
        <form className={s.saveForm} onSubmit={(event) => void save(event)}>
          <Field label={t('clients.network.save.name')} value={saving} maxLength={60} onChange={(event) => setSaving(event.target.value)} />
          <div className={s.actions}>
            <Button variant="quiet" size="sm" onClick={() => setSaving(null)}>{t('clients.network.save.cancel')}</Button>
            <Button type="submit" size="sm">{t('clients.network.save.go')}</Button>
          </div>
        </form>
      )}
      {saved && <p className={s.said} role="status">{t('clients.network.saved', { name: saved })}</p>}
      {view.traits.length > 0 && (
        <div className={s.traits}>
          <span id={tracesId} className={s.meta}>{t('clients.network.lookedFor')}</span>
          <ul className={s.traitList} aria-labelledby={tracesId}>
            {view.traits.map((trait, index) => <li key={trait.id} className={s.trait}><span className="mono">{index + 1}</span>{trait.label}</li>)}
          </ul>
        </div>
      )}
      {webWords && <p className={s.webLine}>{webWords}</p>}
      <ul className={s.resultList}>
        {results.map((result, index) => <ResultCard key={result.person?.id ?? `${result.url}-${index}`} result={result} searchId={view.id} />)}
      </ul>
      {more && (
        <div className={s.more}>
          <Button disabled={busy} onClick={() => void findMore()}>{t('clients.network.more')}</Button>
          <span className={s.meta}>{t('clients.network.more.line')}</span>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/**
 * One result, D's `.res`: who they are, how well you know them (the dots and the receipt chip beside them, both opening
 * the tie's receipt), why they fit, the checks, the path, and Add to pipeline and Open in LinkedIn.
 */
function ResultCard({ result, searchId }: { result: SearchResultView; searchId: string }) {
  const t = useT();
  const engine = useEngine();
  const nameId = useId();
  const [stage, setStage] = useState<PipelineStage | null>(result.inPipeline);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const person = result.person;

  async function add() {
    if (!person) return;
    setBusy(true);
    setProblem(null);
    try {
      const { card } = await engine.request('venture.pipeline.add', { personId: person.id, trigger: { kind: 'search', ref: searchId } });
      setStage(card.stage);
      clientsChanged(engine);
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const name = person?.name ?? t('clients.network.cold');
  const role = person ? roleLine(t, person) : null;
  const why = result.why.startsWith('Why: ') ? <><b>{result.why.slice(0, 4)}</b>{quoted(result.why.slice(4))}</> : quoted(result.why);
  return (
    <li>
      <Tile as="article" card labelledBy={nameId} className={s.result} data-cold={result.cold ? '' : undefined}>
        <div className={s.top}>
          {person ? <Avatar name={person.name} size={52} /> : <span className={s.coldMark} aria-hidden="true"><Icon name="search" size={20} /></span>}
          <div className={s.who}>
            <div className={s.nameRow}>
              <h3 id={nameId} className={s.name}>{name}</h3>
              {person?.degree && <span className={`${s.degree} mono`}>{t(`clients.network.degree.${person.degree}`)}</span>}
            </div>
            {role && <p className={s.role}>{role}</p>}
          </div>
          {person && (
            <div className={s.strength}>
              <StrengthDots level={dotsOf(person)} onOpen={() => (result.receiptId ? openSheet('receipt', result.receiptId) : openSheet('person', person.id))} />
              {result.receiptId && <Receipt id={result.receiptId} />}
            </div>
          )}
        </div>
        <p className={s.why} data-why="">{why}</p>
        {result.checks.length > 0 && (
          <details className={s.checks}>
            <summary className={s.checksSummary}><Icon name="chevron-right" size={14} />{t('clients.network.checks')}</summary>
            <ul className={s.checkList}>
              {result.checks.map((check, index) => (
                <li key={index} data-check={check.check}>
                  {t('clients.network.check', { trait: check.trait, word: t(`clients.network.check.${check.check}`) })}
                  {check.quote && <> <span className={s.quote} data-content="">{`"${check.quote}"`}</span></>}
                  {check.source && <> <span className={s.source}>{check.source}</span></>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {result.path && person && <Inner card={false} className={s.pathBox}><WarmPath path={result.path} name={person.name} /></Inner>}
        <div className={s.resultActions}>
          {person && (stage
            ? <Chip tone="line">{t('clients.network.inPipeline', { stage: t(`clients.network.stage.${stage}`) })}</Chip>
            : <Button disabled={busy} onClick={() => void add()}>{t('clients.network.add')}</Button>)}
          {person && result.linkedin && <LinkedInButton href={result.linkedin} />}
          {person && <Button variant="quiet" aria-label={t('clients.network.openName', { name: person.name })} onClick={(event) => openSheet('person', person.id, event.currentTarget)}>{t('clients.network.open')}</Button>}
          {person && <NetworkDrafts result={result} searchId={searchId} stage={stage} onStage={setStage} />}
          {!person && result.url && <ExternalLink href={result.url}>{t('clients.network.page')}</ExternalLink>}
        </div>
        {problem && <p className={s.problem} role="alert">{problem}</p>}
      </Tile>
    </li>
  );
}

/** Browse everyone: a page at a time, filtered by name or company once the typing stops (the engine's own match). */
function Everyone() {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // The filter asks only once the typing stops; useResource drops an answer a newer request overtook.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(typed.trim()); setLimit(PAGE); }, FILTER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const people = useResource('venture.network.people', query ? { query, limit } : { limit }, { refreshOn: networkRefresh });
  useClientsChanged(engine, () => people.reload());
  const view = people.data;
  return (
    <Tile as="section" labelledBy={titleId} pad="compact" className={s.everyone}>
      <TileHead id={titleId} title={t('clients.network.people.title')} meta={view && view.total > 0 ? t('clients.network.people.shown', { shown: String(view.people.length), total: String(view.total) }) : undefined} />
      <Field label={t('clients.network.people.filter')} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
      {people.error && <p className={s.problem} role="alert">{t('sheet.failed', { message: people.error.message })}</p>}
      {view && view.people.length === 0 && <p className={s.quiet}>{t('clients.network.people.none')}</p>}
      {view && view.people.length > 0 && (
        <ul className={s.peopleList} aria-labelledby={titleId}>
          {view.people.map((person) => (
            <Row
              key={person.id}
              id={person.id}
              mark={<Avatar name={person.name} size={32} />}
              title={person.name}
              line={roleLine(t, person) ?? undefined}
              onOpen={(origin) => openSheet('person', person.id, origin)}
              aside={<StrengthDots level={dotsOf(person)} />}
            />
          ))}
        </ul>
      )}
      {view && view.total > view.people.length && <div className={s.actions}><Button size="sm" onClick={() => setLimit((now) => Math.min(now + PAGE, 500))}>{t('clients.network.people.more')}</Button></div>}
    </Tile>
  );
}
