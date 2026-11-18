/**
 * Find customers (sheet `find:new`, opened from the Pipeline tab): the owner starts a search for possible customers.
 * The engine seeds the brief from the way to earn the owner kept; the owner finishes it and reviews the card. The
 * card is the same one that goes on Today, in the engine's exact words: where it looks, how many, which connected
 * tool it calls and what that costs. Nothing runs until the owner approves that card, here (through Today's own
 * decision, venture.queue.decide) or on Today; a card that asks twice is approved on Today. While what is sold is not
 * ready, the sheet shows the engine's own line and no form. Chausar finds and lists; it never sends.
 *
 * Every sentence below a field label is the engine's. The screen adds labels and buttons only.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Field } from '../../parts/Field';
import { Select } from '../../parts/Select';
import { Sheet } from '../../parts/Sheet';
import type { FindBrief, FindCustomersView, FindProposedOf, FindSource, ProposalView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { clientsChanged, useClientsChanged } from './signals';
import { pipelineRefresh } from './pipeline';
import s from './Clients.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Card = FindProposedOf<ProposalView>;

export function FindCustomersSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.leads.find.view', {}, { refreshOn: pipelineRefresh });
  useClientsChanged(engine, () => view.reload());
  const [card, setCard] = useState<Card | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const title = view.error ? t('sheet.failed', { message: view.error.message }) : t('clients.find.open');

  return (
    <Sheet label={t('clients.find.open')} title={title} onClose={onClose} returnFocus={returnFocus}>
      {view.data && (
        <>
          {view.data.gate && <p className={s.quiet} role="status">{view.data.gate}</p>}
          {/* The engine's one line when the plan's customers are not places on a map (customers/find-brief.ts). */}
          {view.data.ready && view.data.mapNote && <p className={s.quiet} data-map-note="">{view.data.mapNote}</p>}
          {outcome && <p className={s.quiet} role="status">{outcome}</p>}
          {view.data.ready && !card && <BriefForm view={view.data} onCard={(next) => { setOutcome(null); setCard(next); }} />}
          {card && <CardToApprove card={card} onBack={() => setCard(null)} onDone={(line) => { setCard(null); setOutcome(line); clientsChanged(engine); view.reload(); }} />}
          <Sources view={view.data} />
          <Found view={view.data} />
        </>
      )}
    </Sheet>
  );
}

/** The brief, seeded by the engine. Review sends it to venture.leads.find.propose, which makes the card. */
function BriefForm({ view, onCard }: { view: FindCustomersView; onCard(card: Card): void }) {
  const t = useT();
  const engine = useEngine();
  const [who, setWho] = useState(view.brief.who);
  const [place, setPlace] = useState(view.brief.place);
  const [category, setCategory] = useState(view.brief.category);
  const [count, setCount] = useState(String(view.brief.count));
  const [sourceId, setSourceId] = useState('public-map');
  const [tool, setTool] = useState('');
  const [inputs, setInputs] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const usable = view.sources.filter((source) => source.usable);
  const connected = sourceId !== 'public-map';
  const tools = useResource('venture.leads.find.tools', { serverId: sourceId }, { skip: !connected });
  useEffect(() => { setTool(''); }, [sourceId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let source: FindSource = { kind: 'public-map' };
    if (connected) {
      let parsed: unknown;
      try { parsed = JSON.parse(inputs); } catch { parsed = null; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setProblem(t('clients.find.inputsBad')); return; }
      source = { kind: 'connected', serverId: sourceId, tool, arguments: parsed as Extract<FindSource, { kind: 'connected' }>['arguments'] };
    }
    const brief: FindBrief = { who: who.trim(), place: place.trim(), category, count: Number(count), source };
    setBusy(true);
    setProblem(null);
    try {
      onCard(await engine.request('venture.leads.find.propose', { brief }));
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={t('clients.find.who')} value={who} onChange={(event) => setWho(event.target.value)} autoComplete="off" maxLength={200} />
      <Field label={t('clients.find.city')} value={place} onChange={(event) => setPlace(event.target.value)} autoComplete="off" maxLength={100} />
      <Select label={t('clients.find.kind')} value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">{t('clients.find.kindNone')}</option>
        {view.kinds.map((kind) => <option key={kind.tag} value={kind.tag}>{kind.label}</option>)}
      </Select>
      <Field label={t('clients.find.count')} type="number" min={1} max={50} value={count} onChange={(event) => setCount(event.target.value)} />
      {usable.length > 1 && (
        <Select label={t('clients.find.with')} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          {usable.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </Select>
      )}
      {connected && (
        <>
          <Select label={t('clients.find.tool')} value={tool} onChange={(event) => setTool(event.target.value)} error={tools.error?.message}>
            <option value="">{t('clients.find.kindNone')}</option>
            {(tools.data?.tools ?? []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </Select>
          {/* The tool's own description, as its server wrote it: quoted, not Chausar stating anything. */}
          {tool && <p className={s.quiet} data-content="">{tools.data?.tools.find((item) => item.name === tool)?.description}</p>}
          <Field multiline label={t('clients.find.inputs')} value={inputs} onChange={(event) => setInputs(event.target.value)} rows={4} maxLength={8000} />
        </>
      )}
      {problem && <p className={s.failed} role="alert">{t('clients.leads.failed', { message: problem })}</p>}
      <div className={s.formActions}>
        <Button variant="primary" type="submit" disabled={busy}>{t('clients.find.review')}</Button>
      </div>
    </form>
  );
}

/**
 * The card as the engine wrote it. Approve is Today's own decision on this card (venture.queue.decide with the row's
 * digest), so it is the same approval; a card that asks twice (a call that may cost) is approved on Today.
 */
function CardToApprove({ card, onBack, onDone }: { card: Card; onBack(): void; onDone(line: string): void }) {
  const t = useT();
  const engine = useEngine();
  const heading = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function decide(action: 'approve' | 'deny') {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const row = (await engine.request('venture.queue.list', {})).rows.find((item) => item.id === card.rowId);
      if (!row) { setProblem(t('clients.find.gone')); return; }
      const decided = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action });
      // Change it takes the card off Today (Not now there) and opens the brief again; Approve ends with the engine's line.
      if (decided.outcome !== 'done') setProblem(decided.line);
      else if (action === 'deny') onBack();
      else onDone(decided.line);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={heading} className={s.form}>
      <h3 id={heading} className={s.heading}>{card.title}</h3>
      <p>{card.line}</p>
      {problem && <p className={s.failed} role="alert">{t('clients.leads.failed', { message: problem })}</p>}
      <div className={s.formActions}>
        <Button disabled={busy} onClick={() => void decide('deny')}>{t('clients.find.change')}</Button>
        {card.proposal.secondAsk
          ? <a className={s.link} href="#/today">{t('clients.find.onToday')}</a>
          : <Button variant="primary" disabled={busy} onClick={() => void decide('approve')}>{t('clients.find.approve')}</Button>}
      </div>
    </section>
  );
}

/** The lead sources with the engine's honest labels, and the way to connect one: the existing MCP servers form. */
function Sources({ view }: { view: FindCustomersView }) {
  const t = useT();
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className={s.heading}>{t('clients.find.sources')}</h3>
      <ul className={s.items} aria-labelledby={heading}>
        {view.sources.map((source) => (
          <li key={source.id} className={s.draft}>
            <span className={s.draftTo}>{source.name} <ConnectorLabel label={source.label} /></span>
            <span>{source.line}</span>
            {source.waitsOn && <span className={s.quiet}>{source.waitsOn} {source.meanwhile}</span>}
          </li>
        ))}
      </ul>
      {view.note && <p className={s.quiet}>{view.note}</p>}
      <p className={s.blockLine}><a className={s.link} href="#/connections/ai" data-connect-lead-tool="">{t('clients.find.connect')}</a></p>
    </section>
  );
}

/** What the searches found, each with where it came from, and each search with the engine's line on where it stands. */
function Found({ view }: { view: FindCustomersView }) {
  const t = useT();
  const heading = useId();
  if (!view.searches.length && !view.found.length) return null;
  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className={s.heading}>{t('clients.find.found')}</h3>
      <ul className={s.items} aria-labelledby={heading}>
        {view.searches.map((search) => (
          <li key={search.id} className={s.draft} data-search-state={search.state}>
            <span className={s.draftTo}>{search.title}</span>
            <span className={s.quiet}>{search.line}</span>
            {/* Its card waits on Today: never tried yet, or back there after a try that did not work. */}
            {search.rowId && <a className={s.link} data-search-card="" href={`#/today?row=${encodeURIComponent(search.rowId)}`}>{t(search.state === 'proposed' ? 'clients.find.onToday' : 'clients.find.again')}</a>}
          </li>
        ))}
        {view.found.map((lead) => (
          <li key={lead.leadId} className={s.draft}>
            <Button variant="quiet" onClick={() => openSheet('lead', lead.leadId)}>{lead.name}</Button>
            <span className={s.quiet}>{lead.source}. {lead.licence}</span>
            <span data-code="" className="mono">{lead.sourceUrl}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
