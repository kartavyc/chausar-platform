/**
 * Today (Ink v2, D-Today): the greeting, the goal card, the team at work, then everything that needs the owner across
 * every business on this computer as cards (six big, four compact, the rest folded), with filter chips held in the
 * address; under them Working now and Earlier. Decided cards shrink to one receipt line for the rest of the session.
 * Keys (J, K, Enter, A, D) come from the shell and move through the cards as through rows.
 */

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { goTo, openSheet, setQuery, useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { StartAtLogin } from '../onboarding/StartAtLogin';
import { PausedNote } from '../../shell/PausedNote';
import { PausedWork } from '../../parts/paused';
import { useNarrow } from '../../shell/useNarrow';
import { refusalWords } from '../../parts/custody';
import { LeftContext } from '../onboarding/started';
import { ApprovalRow, decidedWords, type ApprovalHandle, type DecideExtra } from '../../parts/ApprovalRow';
import type { AvatarState } from '../../parts/Avatar';
import { Receipt } from '../../parts/Receipt';
import { SwipeCard } from '../../parts/SwipeCard';
import { cx } from '../../parts/cx';
import { EngineError, type QueueAction, type QueueDecision, type QueueList, type QueueRow, type VentureRunEvent } from '../../engine/types';
import type { SheetComponent } from '../../shell/sheets';
import { decide as decideRow, reread as rereadRow, seenKey, undoOf, useTodaySession, type DecidedLine } from './session';
import { ViewSheet, viewSheetId } from './ViewSheet';
import { Greeting } from './Greeting';
import { TodayGoal } from './GoalCard';
import { TeamAtWork } from './TeamAtWork';
import { BIG_CARDS, COMPACT_CARDS, NeedsYou, SwipeTip, knownFilter, matchesFilter, type CardLayout, type NeedsItem } from './NeedsYou';
import { useCardPreview } from './CardPreview';
// W4 4J19: a draft card's Send back and Edit, Undo on a decided line, a probe notice's Open, the edit sheet.
import { UndoButton, draftToolsFor, openNotice } from './SendBack';
import { EditSheet } from './EditSheet';
import { WorkReceiptSheet } from './WorkReceiptSheet';
import { DraftsProvider } from './drafts';
import { actionWords, useOutreachOpen, useOutreachPreview, wordedRow } from './OutreachRows';
import { MeetingNotes } from './MeetingNotes';
import { WorkingNow, focusRow } from './WorkingNow';
import { Earlier } from './Earlier';
// W4 4J22b: an agent's question card says the answer back on its send button; ideas and who waits on you, folded last.
import { useAnswerLabel } from './QuestionsCard';
import { IdeasFold } from './IdeasFold';
// W6 6J2: a short question after a milestone, only while usage reports are on.
import { FeedbackQuestion } from '../../parts/FeedbackQuestion';
import { RUN_EVENTS, agentStateOf, runStateOf, useRunDetails } from './runs';
import s from './Today.module.css';
// W6 6H3 (D40): the page's layout as data, the AI's changes with Undo and Keep, and the Arrange sheet.
import { drawnBlocks, useLayout } from '../../parts/layout/useLayout';
import { LayoutNotice } from '../../parts/layout/LayoutNotice';
import { ArrangeButton } from '../../parts/layout/ArrangeButton';
import { LayoutSheet } from '../../parts/layout/LayoutSheet';
import ls from '../../parts/layout/Layout.module.css';
// W6 6H1 (D39): the mini apps the owner pinned to Today (nothing when none is pinned).
import { PinnedApps } from '../apps';

/** A run waiting on the owner adds a row; a failed run adds "Run again". */
const QUEUE_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.failed';
/** The team list changes with a posture or gate change, which the engine says with a queue change; the agents' states
 *  come from the runs, read on their own. */
const TEAM_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';
/** The open business's plan changes when it is accepted or edited, or another business opens: a queue change. */
const PLAN_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';

/**
 * The engine's order: plan, prices and setup rows lead, then oldest first, locked businesses last. A row keeps the
 * place it had when it first appeared, so a decided row shrinks where it was instead of jumping.
 */
const order = (place: (id: string) => number) => (a: QueueRow, b: QueueRow) =>
  (a.kind === 'locked' ? 1 : 0) - (b.kind === 'locked' ? 1 : 0) || place(a.id) - place(b.id);

/** Cards swiped to the end on a phone (session.defer) come after every other card, in the order they were swiped. */
const deferredLast = (rank: (id: string) => number) => (a: QueueRow, b: QueueRow) => {
  const ra = rank(a.id);
  const rb = rank(b.id);
  return (ra > 0 ? 1 : 0) - (rb > 0 ? 1 : 0) || ra - rb;
};

/** Actions that take the owner where the thing is done. The engine refuses them as decisions (NOT_A_DECISION). */
const PLACES_FOR: Partial<Record<QueueAction['id'], () => void>> = {
  connect: () => goTo('connections'),
  'set-prices': () => goTo('business', 'prices'),
  keep: () => goTo('business', 'keep'),
};

/**
 * Primaries that are not a queue decision: opening a locked business (it closes the one open now), the ones that take
 * the owner to another place, and opening the thing to look at. A swipe right never presses them (3H1 review): on a
 * phone those cards swipe left only.
 */
const NOT_DECISIONS: ReadonlySet<QueueAction['id']> = new Set<QueueAction['id']>(['open', 'watch', 'read', ...(Object.keys(PLACES_FOR) as QueueAction['id'][])]);

const focusedRowId = () => (document.activeElement as HTMLElement | null)?.closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null;

/**
 * 4Z2: the engine's summary in the screen's words, from its counts (queue.ts summaryOf: how many need you, across how
 * many businesses), so a Hindi screen reads Hindi. A locked business is its own card below, which says so. With nothing
 * counted, the engine's sentence stands.
 */
function summaryWords(t: T, list: QueueList): string {
  if (list.needsYou === 0) return list.summary;
  return list.businesses > 1 ? t('today.sub.across', { count: list.needsYou, businesses: list.businesses }) : t('today.needs.count', { count: list.needsYou });
}

/** Two sentences on one line: the engine's summary and the working count, with a full stop between them. */
function sentences(first: string | undefined, second: string | undefined): string | undefined {
  if (!first) return second;
  if (!second) return first;
  return /[.!?।]$/.test(first.trim()) ? `${first} ${second}` : `${first}. ${second}`;
}

export function Place() {
  const t = useT();
  const client = useEngine();
  const left = useContext(LeftContext);
  const session = useTodaySession();
  const route = useRoute();
  const narrow = useNarrow();
  const openOutreach = useOutreachOpen(); // 4E4: a follow-up's handoff, Reply in Mail, Add notes
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: QUEUE_EVENTS });
  // C4 task 5: while paused, cards that would start new work lock their primary (parts/paused.ts).
  const business = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const runList = useResource('venture.runs.list', { state: 'all' }, { refreshOn: RUN_EVENTS });
  const team = useResource('venture.team.list', {}, { refreshOn: TEAM_EVENTS });
  const layout = useLayout('today');
  // A stale decision hands back the new version; it shows until the list itself catches up.
  const [newer, setNewer] = useState<ReadonlyMap<string, { from: string; latest: QueueRow }>>(new Map());
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  // The rows past the compact cards are shown; and a card the page was asked to bring into view and focus.
  const [expanded, setExpanded] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const listed = useRef<Map<string, QueueRow> | null>(null);

  const live = (queue.data?.rows ?? []).filter((row) => !session.isHidden(row.id)).map((row) => {
    const swap = newer.get(row.id);
    return swap && swap.from === row.digest ? swap.latest : row;
  });
  const runs = runList.data?.runs ?? [];
  // Whether the open business charges tax, from its plan: a file's card shows tax figures only then. The engine lists
  // only the open business's rows (another business comes as a locked row), so its plan speaks for every card.
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: PLAN_EVENTS, skip: !live.some((row) => row.viewRef?.kind === 'file') });
  const taxRegistered = plan.data?.blueprint.backOffice.taxRegistered.value === true;

  // A row that leaves the list without being decided here was resolved somewhere else (the run sheet, another
  // window). Rows of a business that just became locked (the owner switched business) leave quietly.
  useEffect(() => {
    const rows = queue.data?.rows;
    if (!rows) return;
    const now = new Set(rows.map((row) => row.id));
    const locked = new Set(rows.filter((row) => row.kind === 'locked').map((row) => row.businessId));
    for (const [id, row] of listed.current ?? []) {
      if (now.has(id) || row.kind === 'locked' || locked.has(row.businessId) || session.isBusy(id) || session.isHidden(id)) continue;
      session.keep(row, t('approval.elsewhere'), undefined, false);
    }
    listed.current = new Map(rows.map((row) => [row.id, row]));
  }, [queue.data, session, t]);

  useEffect(() => {
    if (!focusAfter) return;
    setFocusAfter(null);
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected || focusedRowId() === focusAfter) focusRow(focusAfter);
  }, [focusAfter]);

  // A card asked for from elsewhere on the page ("Answer below", "Show 2 more") takes focus once it is drawn, after a
  // filter or the fold has let it show. One that is no longer listed is given up.
  useEffect(() => {
    if (!reveal) return;
    if (focusRow(reveal) || !live.some((row) => row.id === reveal)) setReveal(null);
  });

  // W4 4B3: an agent's chat opens a card here by its subject (`?row=proposal:<id>`; a row's id is its subject and its
  // version). Once the card is listed it comes into view through goToRow, and the address lets go of it.
  // One-shot C4 task 7: the notification centre (and Team's empty state) ask the same with `?focus=<rowId>`, once.
  const askedRow = route.query.row ?? route.query.focus;
  useEffect(() => {
    if (!askedRow) return;
    // C4 task 10: `focus` may name a kind ("plan"): the first card of that kind; `read` opens what it is about too.
    const row = live.find((r) => r.id === askedRow || r.id.startsWith(`${askedRow}:`)) ?? live.find((r) => r.kind === askedRow);
    if (!row) return;
    goToRow(row.id);
    if (route.query.read && row.viewRef) look(row);
    const { row: _asked, focus: _focus, read: _read, ...rest } = route.query;
    setQuery(rest);
  }, [askedRow, live.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function look(row: QueueRow, origin?: HTMLElement) {
    const ref = row.viewRef;
    if (!ref) return;
    if (ref.kind === 'run') {
      session.markViewed(seenKey(row));
      openSheet('run', ref.id, origin);
      return;
    }
    const id = viewSheetId({ kind: ref.kind, id: ref.id });
    session.expect(id, seenKey(row));
    openSheet('view', id, origin);
  }

  /** A decided card settles where it was; the session already keeps its line (session.ts decide). */
  function settle(row: QueueRow, hadFocus: boolean) {
    setSettled((ids) => new Set(ids).add(row.id));
    if (hadFocus) setFocusAfter(row.id);
  }

  /**
   * Open a locked row's business. The engine keeps one business open, so on this computer the open one closes first.
   * A business that needs its passphrase or its recovery code is then asked for it on Welcome back, under its own
   * row; this page never asks for either.
   */
  async function openBusiness(row: QueueRow): Promise<QueueDecision> {
    const hosted = client.transport === 'hosted';
    try {
      if (!hosted) await client.request('workspace.lock', {});
    } catch (error) {
      return { outcome: 'refused', line: refusalWords(error, t), reason: error instanceof EngineError ? error.code : 'OPEN_FAILED' };
    }
    try {
      await client.request('workspace.open', { folder: row.businessId });
      session.hide(row.id);
      return { outcome: 'done', line: t('today.opened') };
    } catch (error) {
      const code = error instanceof EngineError ? error.code : 'OPEN_FAILED';
      if (!hosted) {
        if (code === 'PASSPHRASE_REQUIRED') left({ ask: { folder: row.businessId, with: 'passphrase' } });
        else if (code === 'DEVICE_KEY_FAILED') left({ ask: { folder: row.businessId, with: 'recovery-code' } });
        else left({ problem: refusalWords(error, t) });
        return { outcome: 'refused', line: refusalWords(error, t), reason: code };
      }
      return { outcome: 'refused', line: refusalWords(error, t), reason: code };
    }
  }

  async function decide(row: QueueRow, action: QueueAction, extra: DecideExtra): Promise<QueueDecision> {
    const hadFocus = focusedRowId() === row.id;
    if (action.id === 'open') return openBusiness(row);
    return after(row, await decideRow(client, row, action.id, extra, t), hadFocus);
  }

  /** A decision that timed out: read the list again and keep what the engine holds. It never decides a second time. */
  async function reread(row: QueueRow): Promise<QueueDecision> {
    const hadFocus = focusedRowId() === row.id;
    return after(row, await rereadRow(client, row, 'all', t), hadFocus);
  }

  function after(row: QueueRow, decision: QueueDecision, hadFocus: boolean): QueueDecision {
    if (decision.outcome === 'done' || decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') settle(row, hadFocus);
    else if (decision.outcome === 'stale') {
      const latest = decision.latest;
      if (latest) setNewer((map) => new Map(map).set(row.id, { from: row.digest, latest }));
    }
    return decision;
  }

  function navigate(row: QueueRow, action: QueueAction): boolean {
    if (openOutreach(row, action)) return true;
    if (openNotice(row, action)) return true;
    const go = PLACES_FOR[action.id];
    if (!go) return false;
    go();
    return true;
  }

  // B3: places are taken from a list that is not being read again: a shared list can still be the one from before a
  // write (a new business), and its rows would otherwise keep places ahead of the rows the engine leads with.
  if (!queue.loading) session.placeRows(live);
  const liveIds = new Set(live.map((row) => row.id));
  // B3: a row whose decision is on its way stays a card until the answer, though a refresh dropped it meanwhile.
  const held = session.heldRows().filter((row) => !liveIds.has(row.id) && !session.line(row.id) && !session.isHidden(row.id));
  const items: NeedsItem[] = [
    ...live.map((row) => ({ row, done: session.line(row.id) })),
    ...held.map((row) => ({ row, done: undefined })),
    ...session.lines().filter((line) => !liveIds.has(line.row.id)).map((line) => ({ row: line.row, done: line })),
  ].sort((a, b) => deferredLast((id) => session.deferredRank(id))(a.row, b.row) || order((id) => session.place(id))(a.row, b.row));
  const waiting = items.filter((item) => !item.done).length;
  const filter = knownFilter(route.query.show, live);
  const showBusiness = new Set(live.map((r) => r.businessId)).size > 1;

  /** The card that answers a run waiting on the owner, while it waits. */
  const rowForRun = (runId: string) => live.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && !session.line(row.id))?.id;

  /** Bring a card into view and focus it: clear a filter that hides it and open the fold it sits behind. */
  function goToRow(id: string) {
    const row = live.find((r) => r.id === id);
    if (!row) return;
    const shown = matchesFilter(row, filter) ? filter : 'all';
    if (shown !== filter) chooseFilter('all');
    const place = items.filter((item) => matchesFilter(item.row, shown)).findIndex((item) => item.row.id === id);
    if (place >= BIG_CARDS + COMPACT_CARDS) setExpanded(true);
    setReveal(id);
  }

  function chooseFilter(next: string) {
    const { show: _show, ...rest } = route.query;
    setQuery(next === 'all' ? rest : { ...rest, show: next });
  }

  /** The state of the agent a card is from: its run's own state for a row about a run, else the agent's. */
  function stateFor(row: QueueRow): AvatarState | undefined {
    if (row.viewRef?.kind === 'run') {
      const run = runs.find((r) => r.runId === row.viewRef!.id);
      if (run) return runStateOf(run);
    }
    return row.agent ? agentStateOf(row.agent, runs.filter((run) => run.businessId === row.businessId)) : undefined;
  }

  /** Enter or the title opens what the row is about; a row about a figure opens its receipt. */
  function opener(row: QueueRow): ((row: QueueRow, origin: HTMLElement) => void) | undefined {
    if (row.viewRef) return (r, origin) => look(r, origin);
    const receiptId = row.change?.receiptId;
    if (receiptId && !row.change?.estimate) return (_r, origin) => openSheet('receipt', receiptId, origin);
    return undefined;
  }

  // The cards' handlers stay the same from render to render (each reads the latest state through a ref), so a card is
  // drawn again only when what it shows changes: the page re-renders on every queue, run or session change.
  const cardHandles = useRef(new Map<string, ApprovalHandle>());
  const latest = useRef({ decide, reread, navigate, look, opener, session });
  latest.current = { decide, reread, navigate, look, opener, session };
  const handlers = useMemo(() => ({
    decide: (row: QueueRow, action: QueueAction, extra: DecideExtra) => latest.current.decide(row, action, extra),
    reread: (row: QueueRow) => latest.current.reread(row),
    navigate: (row: QueueRow, action: QueueAction) => latest.current.navigate(row, action),
    view: (row: QueueRow) => latest.current.look(row),
    open: (row: QueueRow, origin: HTMLElement) => latest.current.opener(row)?.(row, origin),
    defer: (row: QueueRow) => latest.current.session.defer(row.id),
    // 4I2: each drawn card's own buttons, so the next best step presses the card's primary through its handle.
    handle: (id: string, handle: ApprovalHandle | null) => { if (handle) cardHandles.current.set(id, handle); else cardHandles.current.delete(id); },
  }), []);

  /** Hide the swipe tip for the session; focus goes to the first card, not lost to the page. */
  function hideTip() {
    const first = items.find((item) => !item.done && matchesFilter(item.row, filter))?.row.id;
    session.hideTip();
    if (first) setReveal(first);
  }

  const card = (item: NeedsItem, layout: CardLayout) => (item.done ? (
    <Decided line={{ ...item.done, undo: undoOf(item.done, live) }} settle={settled.has(item.row.id)} layout={layout} phone={narrow} />
  ) : (
    <TodayCard
      row={item.row}
      layout={layout}
      agentState={stateFor(item.row)}
      viewed={session.isViewed(seenKey(item.row))}
      taxRegistered={taxRegistered}
      showBusiness={showBusiness}
      onDecide={handlers.decide}
      onReread={handlers.reread}
      onAction={handlers.navigate}
      onView={handlers.view}
      onOpen={opener(item.row) ? handlers.open : undefined}
      phone={narrow}
      onDefer={handlers.defer}
      onHandle={handlers.handle}
    />
  ));

  const activeRuns = runs.filter((run) => run.state === 'active').length;
  const summary = waiting > 0 && queue.data ? summaryWords(t, queue.data) : undefined;
  // Keep a just-stopped row mounted while Today refreshes, so the owner's stop receipt and focus survive.
  // Once the queue arrives, a stopped run remains only while its resume row exists (replaced runs have none).
  const workingRuns = runs.filter((run) => ((run.state === 'active' || run.state === 'waiting')
    && (run.stop?.state !== 'stopped' || queue.loading&&queue.data!==undefined || live.some((row) => row.viewRef?.kind === 'run' && row.viewRef.id === run.runId && row.actions.some((a) => a.id === 'resume'))))
    || (run.state === 'failed' && live.some((row) => row.viewRef?.kind === 'run' && row.viewRef.id === run.runId && row.actions.some((a) => a.id === 'run-again') && !session.line(row.id))));
  // Each listed run's steps, read once and shared by the team's live tiles (a subset of these runs) and Working now.
  const details = useRunDetails(workingRuns.map((run) => run.runId));

  // W6 6H3 (D40): the page's blocks in the owner's layout. Approvals, the greeting's count, notices and the goal keep
  // their slots; the other blocks fill the remaining slots in the owner's order. Until the layout comes, the library's.
  const drawn = drawnBlocks('today', layout.data);
  const nameOf = (id: string) => drawn.find((block) => block.id === id)?.name;
  const shown = (index: number) => Boolean(drawn[index]?.shown);
  const blockContent: Readonly<Record<string, () => ReactNode>> = {
    greeting: () => (
      <Greeting
        line={sentences(summary, activeRuns > 0 ? t('today.sub.working', { count: activeRuns }) : undefined)}
        count={summary ? String(queue.data?.needsYou ?? waiting) : undefined}
        tools={<ArrangeButton place="today" />}
      />
    ),
    // A5 fix round 1: start at login, asked once here when the first run ended without an answer.
    notices: () => <><StorageNotice /><PausedNote /><StartAtLogin place="today" /></>,
    goal: () => <TodayGoal next={{ rows: live, isViewed: (row) => session.isViewed(seenKey(row)), isDecided: (id) => Boolean(session.line(id)), goToRow, look: handlers.view, handleOf: (id) => cardHandles.current.get(id) }} spans={showBusiness} />,
    team: () => <TeamAtWork agents={team.data?.agents ?? []} runs={runs} details={details} rowForRun={rowForRun} goToRow={goToRow} phone={narrow} title={nameOf('team')} />,
    needs: () => (
      // W4 4J19: the draft replies the cards show, read once for the page.
      <DraftsProvider>
      <NeedsYou
        items={items}
        loaded={Boolean(queue.data)}
        failed={queue.error?.message}
        filter={filter}
        onFilter={(next) => chooseFilter(next)}
        expanded={expanded}
        onExpand={(first) => { setExpanded(true); if (first) setReveal(first); }}
        card={card}
        phone={narrow}
        tip={narrow && session.showsTip() ? <SwipeTip onHide={hideTip} /> : undefined}
      />
      </DraftsProvider>
    ),
    working: () => <WorkingNow runs={workingRuns} details={details} rowForRun={rowForRun} goToRow={goToRow} title={nameOf('working')} />,
    earlier: () => <Earlier title={nameOf('earlier')} />,
    ideas: () => <IdeasFold title={nameOf('ideas')} />,
    // W6 6H1 (D39): the mini apps the owner pinned to Today, a block of the layout (6H3) like the others.
    apps: () => <PinnedApps />,
  };
  /** The block in slot `index`, in a wrapper that adds no box, or nothing when the owner's layout hides it. */
  const slot = (index: number) => {
    const block = drawn[index];
    if (!block?.shown) return null;
    return <div key={block.id} className={ls.block} data-block={block.id}>{blockContent[block.id]?.()}</div>;
  };
  const ideasHidden = drawn.some((block) => block.id === 'ideas' && !block.shown);

  return (
    <PausedWork.Provider value={Boolean(business.data?.paused)}>
      {slot(0)}
      {slot(1)}
      <LayoutNotice layout={layout.data} reload={layout.reload} />
      {/* One container, so the grids below follow the page's own width (a sheet open beside it narrows it). */}
      <div className={s.today}>
        <div className={s.page}>
          {slot(2)}
          {slot(3)}
        </div>
        {slot(4)}
        {(shown(5) || shown(6)) && (
          <div className={cx(s.bottom, !(shown(5) && shown(6)) && s.bottomOne)}>
            {slot(5)}
            {slot(6)}
          </div>
        )}
        {slot(7)}
        {slot(8)}
        {/* Waiting on you lists what waits on the owner: it shows when the layout hides Ideas too. */}
        {ideasHidden && <IdeasFold ideas={false} />}
        <FeedbackQuestion />
      </div>
    </PausedWork.Provider>
  );
}

interface TodayCardProps {
  row: QueueRow;
  layout: CardLayout;
  agentState: AvatarState | undefined;
  /** The owner opened this version of it in this session (the session keys it by the row's digest). */
  viewed: boolean;
  /** The open business charges tax: a file's card may show its tax figures. */
  taxRegistered: boolean;
  showBusiness: boolean;
  onDecide: (row: QueueRow, action: QueueAction, extra: DecideExtra) => Promise<QueueDecision>;
  onReread: (row: QueueRow) => Promise<QueueDecision>;
  onAction: (row: QueueRow, action: QueueAction) => boolean;
  onView: (row: QueueRow) => void;
  onOpen: ((row: QueueRow, origin: HTMLElement) => void) | undefined;
  /** A phone: the card can be swiped (right for its primary, left for Later) and its buttons are xl. */
  phone: boolean;
  /** Move the card to the end of the list for the session (a left swipe on a card with no Later). */
  onDefer: (row: QueueRow) => void;
  /** Lend the card's own buttons to Today (the next best step presses its primary through them). */
  onHandle: (id: string, handle: ApprovalHandle | null) => void;
}

/**
 * One row as a card, with its preview on a big card. It draws again only when one of its props changes. On a phone
 * it is wrapped in a SwipeCard that presses the card's own buttons through its handle (3B5a's ApprovalHandle), so a
 * swipe can never do what a tap could not: a locked primary stays locked and says why, a second ask opens in the card
 * and decides nothing, and a press while one is on its way sends nothing (spec 8: a swipe never decides money alone).
 * Left presses Later where the row has it; a row without Later moves to the end of the list, with no engine call.
 * Only a card whose primary is a queue decision swipes right (NOT_DECISIONS). A swipe acts only on the version that
 * was on screen when the finger came down: a new version that arrives mid-swipe (its digest changed) is never pressed
 * by that swipe; the card shows it as changed, and the owner swipes again if they want to.
 */
const TodayCard = memo(function TodayCard({ row, layout, agentState, viewed, taxRegistered, showBusiness, onDecide, onReread, onAction, onView, onOpen, phone, onDefer, onHandle }: TodayCardProps) {
  const t = useT();
  const handle = useRef<ApprovalHandle | null>(null);
  // The card's buttons, for the swipe here and for Today's next best step (4I2).
  const register = useCallback((next: ApprovalHandle | null) => { handle.current = next; onHandle(row.id, next); }, [onHandle, row.id]);
  // The row now, and its digest when the finger last came down on the card (a swipe acts only on that version).
  const latest = useRef(row);
  latest.current = row;
  const started = useRef<string | null>(null);
  const preview = useCardPreview(row, { unseen: !viewed, enabled: layout === 'card', taxRegistered });
  const outreach = useOutreachPreview(row); // 4E4: what a follow-up's or a reply's handoff did
  const answerLabel = useAnswerLabel(row);
  const card = (
    <ApprovalRow
      row={wordedRow(row, t)}
      layout={layout}
      agentState={agentState}
      preview={outreach ?? preview}
      tools={draftToolsFor(row)}
      viewed={viewed}
      onDecide={onDecide}
      onReread={onReread}
      onAction={onAction}
      showBusiness={showBusiness}
      onView={onView}
      onOpen={onOpen}
      handle={register}
      buttonSize={phone ? 'xl' : undefined}
      answerLabel={answerLabel}
    />
  );
  if (!phone) return card;
  // Until the card has drawn once its handle is not set; the row's own primary says the same words meanwhile.
  const fromRow = row.actions.find((action) => action.primary) ?? row.actions[0];
  const later = row.actions.find((action) => action.id === 'later');
  const decides = fromRow !== undefined && !NOT_DECISIONS.has(fromRow.id);
  /** The version on screen when the finger came down is still the one on screen. */
  const same = () => started.current === latest.current.digest;
  return (
    <div className={s.swipe} onPointerDownCapture={() => { started.current = latest.current.digest; }}>
      <SwipeCard
        rightLabel={() => handle.current?.primary().label ?? (fromRow ? actionWords(fromRow.label, t) : '')}
        asksAgain={() => handle.current?.primary().asksAgain ?? Boolean(fromRow?.secondAsk)}
        rightLocked={() => handle.current?.primary().locked ?? false}
        // The card's own note line already says why it is locked; the swipe adds nothing under it.
        lockedNote=""
        leftLabel={later ? actionWords(later.label, t) : t('today.swipe.skip')}
        onRight={decides ? () => (same() ? handle.current?.pressPrimary() : 'none') : undefined}
        onLeft={() => {
          if (!same()) return 'none';
          const result = handle.current?.pressLater();
          if (result === 'none' && !later) onDefer(row);
          return result;
        }}
      >
        {card}
      </SwipeCard>
    </div>
  );
});

/** A decided card, shrunk to one line: title, what was done, and its receipt. It stays until the session ends. */
function Decided({ line: { row, line, receiptId, undo }, settle, layout, phone = false }: { line: DecidedLine; settle: boolean; layout: CardLayout; phone?: boolean }) {
  const t = useT();
  // 4Z3: the receipt is a mark after the line; its code is not printed (the engine's line may end with it).
  const said = receiptId && line.endsWith(receiptId) ? line.slice(0, -receiptId.length).replace(/\s*·\s*$/, '') : line;
  // B3: a plan row's line is the engine's outcome alone (its title is an ask).
  const { title } = decidedWords(row, said, t);
  return (
    <article className={cx(s.decided, settle && s.settle)} data-row="" data-row-id={row.id} data-decided="" data-layout={layout} tabIndex={-1}>
      <span role="status">
        {title !== null && <><span className={s.decidedTitle}>{title}</span>{' · '}</>}
        {said}
        {receiptId && <>{' '}<Receipt id={receiptId} /></>}
        {undo && <UndoButton row={row} undo={undo} phone={phone} />}
      </span>
    </article>
  );
}

// W6 6H3: `layout` (the Arrange sheet) serves every place that has a layout; it is registered here once.
export const sheets: Readonly<Record<string, SheetComponent>> = { view: ViewSheet, 'call-notes': MeetingNotes, 'edit-draft': EditSheet, 'work-receipt': WorkReceiptSheet, layout: LayoutSheet };
