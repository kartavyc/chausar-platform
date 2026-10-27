/**
 * The person sheet beside the Network tab (`?sheet=person:<id>`; 4D4 from the engine's 4D1 to 4D3): who they are and
 * how well you know them (the five dots open the tie receipt); How you know them (the tie's lines, each from its file,
 * with the receipt); Paths (each warm path, "possible path, not confirmed" where the engine cannot confirm one); the
 * pipeline card or Add to pipeline; Before you write (public pages only, through the engine's web search, which says
 * plainly when it is not set up); What Chausar keeps (every field with its source row: the DPDP notice); Split for a
 * person two files merged; Hide; and Forget, which asks once more and says what goes and what stays, then shows the
 * engine's own words. Chausar never writes to the person from here.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { closeSheet, openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Chip } from '../../parts/Chip';
import { Receipt } from '../../parts/Receipt';
import { Sheet } from '../../parts/Sheet';
import { StrengthDots } from '../../parts/StrengthDots';
import type { PersonView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { ExternalLink } from '../connections/external';
import { clientsChanged, useClientsChanged } from './signals';
import { dotsOf, LinkedInButton, messageOf, networkRefresh, personForgotten, roleLine, WarmPath } from './network';
import s from './Network.module.css';

export function PersonSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const person = useResource('venture.network.person', { id }, { refreshOn: networkRefresh });
  const [forgotten, setForgotten] = useState<{ name: string; line: string; kept: string[] } | null>(null);
  useClientsChanged(engine, () => { if (!forgotten) person.reload(); });

  const view = person.data;
  const title = forgotten ? t('clients.person.forgotten')
    : person.error ? (person.error.code === 'INVALID_VENTURE_REQUEST' ? t('clients.person.notFound') : t('sheet.failed', { message: person.error.message }))
      : view ? view.person.name : t('sheet.loading');

  return (
    <Sheet
      label={t('clients.person.sheet')}
      title={title}
      name={view?.person.name}
      line={forgotten ? forgotten.line : view ? roleLine(t, view.person) ?? undefined : undefined}
      avatar={!forgotten && view ? <Avatar name={view.person.name} size={40} /> : undefined}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {forgotten ? <Forgotten {...forgotten} /> : view && <Body view={view} reload={person.reload} onForgotten={setForgotten} />}
    </Sheet>
  );
}

function Body({ view, reload, onForgotten }: { view: PersonView; reload: () => void; onForgotten: (forgotten: { name: string; line: string; kept: string[] }) => void }) {
  const t = useT();
  const engine = useEngine();
  const howId = useId();
  const pathsId = useId();
  const pipelineId = useId();
  const beforeId = useId();
  const keepsId = useId();
  const splitId = useId();
  const { person } = view;
  const tie = view.how.find((item) => item.receiptId)?.receiptId ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept here, so the line stays once the person is no longer merged and Split has gone.
  const [splitLine, setSplitLine] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      clientsChanged(engine);
      reload();
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={s.sheetTop}>
        <StrengthDots level={dotsOf(person)} onOpen={tie ? () => openSheet('receipt', tie) : undefined} />
        {person.hidden && <p className={s.quiet}>{t('clients.person.hidden')}</p>}
      </div>

      <section className={s.sheetSection} aria-labelledby={howId}>
        <h3 id={howId} className={s.heading}>{t('clients.person.how')}</h3>
        {view.how.length === 0 ? <p className={s.quiet}>{t('clients.person.how.none')}</p> : (
          <>
            <ul className={s.lines}>{view.how.map((item, index) => <li key={index}>{item.line}</li>)}</ul>
            {tie && <Receipt id={tie} />}
          </>
        )}
      </section>

      <section className={s.sheetSection} aria-labelledby={pathsId}>
        <h3 id={pathsId} className={s.heading}>{t('clients.person.paths')}</h3>
        {view.paths.length === 0 ? <p className={s.quiet}>{t('clients.person.paths.none')}</p>
          : view.paths.map((path, index) => <Inner key={index} card={false} className={s.pathBox}><WarmPath path={path} name={person.name} /></Inner>)}
      </section>

      <section className={s.sheetSection} aria-labelledby={pipelineId}>
        <h3 id={pipelineId} className={s.heading}>{t('clients.person.pipeline')}</h3>
        {view.card ? (
          <p className={s.cardLine}>
            <Chip tone="line">{t('clients.network.inPipeline', { stage: t(`clients.network.stage.${view.card.stage}`) })}</Chip>
            {view.card.next && <span>{view.card.next.line}</span>}
          </p>
        ) : (
          <div className={s.actions}>
            <span className={s.quiet}>{t('clients.person.pipeline.none')}</span>
            <Button size="sm" disabled={busy} onClick={() => void act(() => engine.request('venture.pipeline.add', { personId: person.id, trigger: { kind: 'owner' } }))}>{t('clients.network.add')}</Button>
          </div>
        )}
        {view.drafts.length > 0 && <p className={s.quiet}>{t('clients.person.drafts', { count: view.drafts.length })}</p>}
        {/* W5 5A2: a sales proposal for them, drafted from the records; it waits on Today, and the owner sends it. */}
        <div className={s.actions}><Button size="sm" onClick={(event) => openSheet('proposal', `person:${person.id}`, event.currentTarget)}>{t('kit-sales.proposal.open')}</Button></div>
      </section>

      <BeforeYouWrite id={beforeId} view={view} />

      <section className={s.sheetSection} aria-labelledby={keepsId}>
        <h3 id={keepsId} className={s.heading}>{t('clients.person.keeps')}</h3>
        <dl className={s.fields}>
          {view.fields.map((field, index) => (
            <div key={index} className={s.fieldRow}>
              <dt>{field.field}</dt>
              <dd><span data-content="">{field.value}</span><span className={s.source}>{field.source}</span></dd>
            </div>
          ))}
        </dl>
        {view.linkedin && <p className={s.linkLine}><LinkedInButton href={view.linkedin} /></p>}
      </section>

      {view.merged && <Split id={splitId} view={view} onDone={setSplitLine} />}
      {splitLine && <p className={s.said} role="status">{splitLine}</p>}

      <Leave view={view} busy={busy} act={act} onForgotten={onForgotten} />

      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </>
  );
}

/**
 * "Before you write": public pages only, never a LinkedIn profile. Where no web search is set up (the sources view says
 * so) a line stands in place of the button, and nothing is asked.
 */
function BeforeYouWrite({ id, view }: { id: string; view: PersonView }) {
  const t = useT();
  const engine = useEngine();
  const sources = useResource('venture.network.sources', {});
  const setUp = sources.data?.webSearch === 'set-up';
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ words: string; lines: { text: string; url: string }[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function look() {
    setBusy(true);
    setProblem(null);
    try {
      const research = await engine.request('venture.network.research', { personId: view.person.id });
      setFound({ words: research.web === 'found' ? research.line : t(`clients.person.before.${research.web}`), lines: research.lines });
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const lines = found?.lines.length ? found.lines : view.web;
  return (
    <section className={s.sheetSection} aria-labelledby={id}>
      <h3 id={id} className={s.heading}>{t('clients.person.before')}</h3>
      <p className={s.quiet}>{t('clients.person.before.line')}</p>
      {lines.length > 0 && (
        <>
          <p className={s.label}>{t('clients.person.web')}</p>
          <ul className={s.lines}>
            {lines.map((line, index) => <li key={index}><span data-content="">{line.text}</span> <ExternalLink href={line.url}>{t('clients.network.page')}</ExternalLink></li>)}
          </ul>
        </>
      )}
      {found && <p className={s.said} role="status">{found.words}</p>}
      {setUp && <div className={s.actions}><Button size="sm" disabled={busy} onClick={() => void look()}>{t('clients.person.before.go')}</Button></div>}
      {sources.data && !setUp && <p className={s.quiet}>{t('clients.person.before.notSetUp')}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** Split: the owner picks the source rows that belong to someone else; the engine moves them to a new person. */
function Split({ id, view, onDone }: { id: string; view: PersonView; onDone: (line: string) => void }) {
  const t = useT();
  const engine = useEngine();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  // One choice per source row, in the order the fields list them.
  const rows = [...new Map(view.fields.map((field) => [field.sourceId, field.source])).entries()];

  async function split() {
    setProblem(null);
    try {
      const result = await engine.request('venture.network.split', { personId: view.person.id, sourceIds: [...chosen] });
      onDone(t('clients.person.split.done', { name: result.split.person.name }));
      setChosen(new Set());
      clientsChanged(engine);
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    }
  }

  return (
    <section className={s.sheetSection} aria-labelledby={id}>
      <h3 id={id} className={s.heading}>{t('clients.person.split')}</h3>
      <p className={s.quiet}>{t('clients.person.split.line')}</p>
      <ul className={s.choices}>
        {rows.map(([sourceId, source]) => (
          <li key={sourceId}>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={chosen.has(sourceId)}
                onChange={(event) => setChosen((now) => { const next = new Set(now); if (event.target.checked) next.add(sourceId); else next.delete(sourceId); return next; })}
              />
              {source}
            </label>
          </li>
        ))}
      </ul>
      <div className={s.actions}><Button size="sm" disabled={chosen.size === 0} onClick={() => void split()}>{t('clients.person.split.go')}</Button></div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** Hide or show again, and Forget with its second ask. */
function Leave({ view, busy, act, onForgotten }: {
  view: PersonView; busy: boolean; act: (work: () => Promise<unknown>) => Promise<void>;
  onForgotten: (forgotten: { name: string; line: string; kept: string[] }) => void;
}) {
  const t = useT();
  const engine = useEngine();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { person } = view;

  async function forget() {
    setProblem(null);
    try {
      const result = await engine.request('venture.network.forget', { id: person.id });
      onForgotten({ name: person.name, line: result.line, kept: result.kept });
      personForgotten(engine, person.id);
      clientsChanged(engine);
    } catch (error) {
      setProblem(t('clients.network.actionFailed', { message: messageOf(error) }));
    }
  }

  return (
    <div className={s.leave}>
      <div className={s.actions}>
        <Button size="sm" disabled={busy} onClick={() => void act(() => engine.request('venture.network.hide', { personId: person.id, hidden: !person.hidden }))}>
          {person.hidden ? t('clients.person.show') : t('clients.person.hide')}
        </Button>
        {!asking && <Button size="sm" variant="quiet" onClick={() => setAsking(true)}>{t('clients.person.forget')}</Button>}
      </div>
      {asking && (
        <Inner card={false} className={s.ask}>
          <p>{t('clients.person.forget.ask')}</p>
          <div className={s.actions}>
            <Button size="sm" variant="quiet" onClick={() => setAsking(false)}>{t('clients.person.forget.keep')}</Button>
            <Button size="sm" onClick={() => void forget()}>{t('clients.person.forget.yes', { name: person.name })}</Button>
          </div>
        </Inner>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}

/** After Forget: the engine's line, and what stays (the law's records, the one-way check, earlier backups). */
function Forgotten({ kept }: { name: string; line: string; kept: string[] }) {
  const t = useT();
  const staysId = useId();
  // The header holds the engine's line; the person's name and role are gone from the sheet.
  return (
    <section className={s.sheetSection} aria-labelledby={staysId}>
      <h3 id={staysId} className={s.heading}>{t('clients.person.forget.stays')}</h3>
      <ul className={s.lines}>{kept.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <div className={s.actions}><Button size="sm" variant="quiet" onClick={() => closeSheet()}>{t('sheet.close')}</Button></div>
    </section>
  );
}
