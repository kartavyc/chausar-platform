/**
 * The Pipeline tab (#/clients/pipeline; the old #/clients/leads opens it too): the pipeline as the engine keeps it
 * (spec 5.5; the direction D board D-Clients; the engine's 4E1 venture.pipeline.list). On top the four tiles, then the
 * filter chips (All, Due soon, Has a draft, and one per business when the board holds more than one) beside the path
 * lines' key; then the board, Found to Not now, Lost and Not now folded; under it "Due today and late" and "How
 * people moved".
 *
 * A card shows who (initials, name, company), how well the owner knows them (five dots, worked out by code), the warm
 * path, the next step with its day (late in the engine's words), the draft waiting and the business. A card that is
 * still only a lead (the lead list's own card) shows its email check and opens the lead sheet; every other card opens
 * the card sheet. Cards move forward only, through the engine: drag one onto a column, or press [ or ] with focus in it.
 * Won, Lost and Not now are never moved in one step: the card sheet opens at Move it with that stage picked. A move
 * that needs its evidence opens there too; any other refusal says the engine's words and the card stays where it was.
 * A moved card keeps focus in its new column. Chausar never sends: the owner sends every message.
 *
 * The filter is held in the address (`show=due` or `show=drafts`, `business=`), so a reload keeps it.
 */

import { useEffect, useId, useState } from 'react';
import { Figure } from '../../parts/Figure';
import { useT, type T } from '../../text';
import { useEngine, useResource, type Resource } from '../../engine/context';
import { openSheet, setQuery, useRoute } from '../../shell/navigation';
import { Board, BoardCard, type BoardColumn } from '../../parts/Board';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips, type FilterOption } from '../../parts/FilterChips';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import { initialsOf } from '../../parts/Avatar';
import { PathLine } from '../../parts/PathLine';
import { StrengthDots } from '../../parts/StrengthDots';
import type { LeadEmailCheck, LeadView, PipelineCardView, PipelineStage, PipelineView } from '../../engine/types';
import { clientsChanged } from './signals';
import { codeOf, dotsOf, messageOf, networkRefresh } from './network';
import { pathPeople, pathStrength, STAGE_ORDER, useCardWords } from './pipeline';
import { PipelineTiles } from './PipelineTiles';
import { DueList } from './DueList';
import { Funnel } from './Funnel';
import s from './Pipeline.module.css';

const CHECK_ICONS: Readonly<Record<LeadEmailCheck['status'], IconName>> = { verified: 'check', unverified: 'circle-help', failed: 'x' };

type Show = 'all' | 'due' | 'drafts';
/** The stages that close a card: a board move to one opens the sheet instead. */
const CLOSING: ReadonlySet<string> = new Set(['won', 'lost', 'not-now']);
const FILTER: Readonly<Record<Exclude<Show, 'all'>, 'due' | 'draft'>> = { due: 'due', drafts: 'draft' };

export function PipelineTab({ board, leads }: { board: Resource<PipelineView>; leads: LeadView[] }) {
  const t = useT();
  const route = useRoute();
  const engine = useEngine();
  const show: Show = route.query.show === 'due' || route.query.show === 'drafts' ? route.query.show : 'all';
  const business = route.query.business;
  // The whole board answers the tiles, the counts and the business chips; a filter asks the engine for its own cards.
  const filtered = useResource('venture.pipeline.list', show === 'all' ? {} : { filter: FILTER[show] }, { skip: show === 'all', refreshOn: networkRefresh });
  const view = show === 'all' ? board.data : filtered.data;
  const [moved, setMoved] = useState<{ line: string; problem: boolean } | null>(null);
  // A moved card's name button takes focus again once the card is drawn in its new column.
  const [refocus, setRefocus] = useState<{ id: string; stage: string } | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const column = document.querySelector(`[data-column="${CSS.escape(refocus.stage)}"]`);
    const button = column?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(refocus.id)}"] [data-open]`);
    if (!button) return;
    button.focus();
    setRefocus(null);
  });

  // A filter the address names that the board does not know leaves it, so the address says what the board shows.
  const stale = route.query.show !== undefined && show === 'all';
  useEffect(() => {
    if (!stale) return;
    const { show: _show, ...rest } = route.query;
    setQuery(rest);
  }, [stale, route.query]);

  if (board.error) return <p className={s.problem} role="alert">{t('sheet.failed', { message: board.error.message })}</p>;
  if (!board.data) return null;
  const all = board.data.columns.reduce((sum, column) => sum + column.count, 0);
  if (all === 0) {
    return (
      <EmptyState
        title={t('clients.pipeline.empty')}
        line={t('clients.pipeline.empty.line')}
        actions={[
          { label: t('clients.pipeline.toNetwork'), href: '#/clients/network' },
          { label: t('clients.leads.add'), onSelect: () => openSheet('lead', 'new') },
        ]}
      />
    );
  }

  const businesses = [...new Set(board.data.columns.flatMap((column) => column.cards.map((card) => card.business)))];
  const choose = (id: string) => {
    const { show: _show, business: _business, ...rest } = route.query;
    if (id === 'due' || id === 'drafts') setQuery({ ...rest, show: id });
    else if (id.startsWith('business:')) setQuery({ ...rest, business: id.slice('business:'.length) });
    else setQuery(rest);
  };
  const options: FilterOption[] = [
    { id: 'all', label: t('clients.pipeline.all'), count: all },
    { id: 'due', label: t('clients.pipeline.due') },
    { id: 'drafts', label: t('clients.pipeline.drafts') },
    // One chip per business only when the board holds more than one: with one, the chip would filter nothing.
    ...(businesses.length > 1 ? businesses.map((name, index) => ({ id: `business:${name}`, label: name, business: true, separatorBefore: index === 0 })) : []),
  ];
  const onlyBusiness = business && businesses.length > 1 && businesses.includes(business) ? business : null;
  const chosen = onlyBusiness ? `business:${onlyBusiness}` : show;

  async function move(cardId: string, to: string) {
    setMoved(null);
    // Closing a card is never one keystroke: the sheet opens at Move it, the stage picked, for the owner to confirm.
    if (CLOSING.has(to)) { openSheet('card', cardId, undefined, `move-${to}`); return; }
    try {
      const { line } = await engine.request('venture.pipeline.move', { id: cardId, stage: to as PipelineStage });
      setMoved({ line, problem: false });
      setRefocus({ id: cardId, stage: to });
      clientsChanged(engine);
      board.reload();
      if (show !== 'all') filtered.reload();
    } catch (error) {
      setMoved({ line: messageOf(error), problem: true });
      // A move that needs its evidence (the day sent, the day they wrote back, what was offered) is given in the sheet.
      if (codeOf(error) === 'PIPELINE_EVIDENCE_REQUIRED') openSheet('card', cardId, undefined, `move-${to}`);
    }
  }

  return (
    <div className={s.pipeline}>
      <PipelineTiles tiles={board.data.tiles} />
      <div className={s.filterRow}>
        <FilterChips label={t('clients.pipeline.show')} value={chosen} onChange={choose} options={options} />
        <PathKey />
      </div>
      {moved && <p className={moved.problem ? s.problem : s.said} role={moved.problem ? 'alert' : 'status'} data-move-line="" data-code={moved.problem ? '' : undefined}>{moved.line}</p>}
      {view && (
        <Board
          label={t('clients.pipeline.board')}
          description={t('clients.pipeline.board.how')}
          columns={columnsOf(t, view, leads, onlyBusiness, businesses.length > 1)}
          limit={5}
          onMove={(cardId, to) => void move(cardId, to)}
        />
      )}
      {filtered.error && <p className={s.problem} role="alert">{t('sheet.failed', { message: filtered.error.message })}</p>}
      <div className={s.below}>
        <DueList onChanged={() => { board.reload(); if (show !== 'all') filtered.reload(); }} />
        <Funnel view={board.data} />
      </div>
    </div>
  );
}

/** The columns in the engine's order, each with the UI's words for its stage. */
function columnsOf(t: T, view: PipelineView, leads: LeadView[], business: string | null, many: boolean): BoardColumn[] {
  const order = new Map(STAGE_ORDER.map((stage, index) => [stage, index]));
  return [...view.columns].sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99)).flatMap((column) => {
    const cards = column.cards.filter((card) => !business || card.business === business);
    // A folded stage with nobody in it would be a control that opens nothing, so it is left out.
    if (column.folded && cards.length === 0) return [];
    return [{
      id: column.stage,
      title: t(`clients.pipeline.stage.${column.stage}`),
      hint: t(`clients.pipeline.sub.${column.stage}`),
      count: business ? cards.length : column.count,
      folded: column.folded,
      cards: cards.map((card) => ({ id: card.id, node: <PipelineCard card={card} lead={leads.find((lead) => lead.id === card.id) ?? null} many={many} /> })),
    }];
  });
}

/** The key to the path lines (D's legend): strong, fair, not confirmed. */
function PathKey() {
  const t = useT();
  const id = useId();
  return (
    <div className={s.legend} role="group" aria-labelledby={id}>
      <span id={id} className="sr-only">{t('clients.pipeline.legend')}</span>
      <span className={s.legendItem}><span className={s.legendLine} data-strength="strong" aria-hidden="true" />{t('clients.pipeline.legend.strong')}</span>
      <span className={s.legendItem}><span className={s.legendLine} data-strength="fair" aria-hidden="true" />{t('clients.pipeline.legend.fair')}</span>
      <span className={s.legendItem}><span className={s.legendLine} data-strength="possible" aria-hidden="true" />{t('clients.pipeline.legend.possible')}</span>
    </div>
  );
}

/** One card on the board (D's `.lift.pc`). A lead's own card opens the lead sheet; every other the card sheet. */
/** many: the board holds more than one business, so each card names its own (simple first: one business needs no name). */
function PipelineCard({ card, lead, many }: { card: PipelineCardView; lead: LeadView | null; many: boolean }) {
  const t = useT();
  const words = useCardWords();
  const open = () => (lead ? openSheet('lead', lead.id) : openSheet('card', card.id));
  return (
    <BoardCard name={card.name} sub={card.company} rowId={card.id} onOpen={open}>
      {lead ? (
        <p className={s.check} data-check={lead.emailCheck.status}>
          <Icon name={CHECK_ICONS[lead.emailCheck.status] ?? 'circle-help'} size={12} />
          {/* The check in two words on the card; the engine's whole line is in the lead sheet, one step away. */}
          <span title={lead.emailCheck.line || undefined}>{t(`clients.pipeline.check.${lead.emailCheck.status}`)}</span>
        </p>
      ) : card.band ? (
        <StrengthDots level={dotsOf(card)} bare />
      ) : null}
      {card.path && card.path.via && (
        <div className={s.path} data-confirmed={String(card.path.confirmed)}>
          <PathLine people={pathPeople(card.path, card.name)} strength={pathStrength(card.path)} layout="card" />
        </div>
      )}
      {card.blocked && <p className={s.blocked} data-blocked=""><Icon name="lock" size={12} />{words.blocked(card.blocked)}</p>}
      {card.quote && (
        <p className={s.quote} data-quote="" data-figure-group="">
          <Figure value={card.quote.value} receiptId={card.quote.receiptId} />
        </p>
      )}
      {card.client && <p className={s.client} data-client=""><Icon name="check" size={12} />{card.client.line}</p>}
      {card.next && (
        <p className={s.next} data-next="" data-late={card.next.late ? '' : undefined}>
          <Icon name={card.next.late ? 'clock' : 'calendar'} size={12} />
          <span>{words.next(card.next)}</span>
        </p>
      )}
      <div className={s.cardFoot}>
        {card.draft ? <span className={s.draft} data-draft="" title={card.draft}><Icon name="file-pen" size={12} />{words.draft(card)}</span> : <span />}
        {many && <span className={s.business} role="img" aria-label={card.business}>{initialsOf(card.business)}</span>}
      </div>
    </BoardCard>
  );
}
