/**
 * SavedScenarios (AS-14 Saved on Ask, Saved; AS-11 and A9.1 for the opened what-if): the
 * released what-if revisions as quiet ledger rows, five at rest in the Engine's order (newest
 * first), every further row one page on. The list stays where it is: the one what-if a person
 * chooses opens beside it in the frame's one right sheet (the host composes `RetainedScenario`
 * there from its fresh checked reopen), and the trusted host pin, which belongs to no list, is
 * drawn alone in the page as before.
 * Rules kept here.
 * - A row shows only what `scenarios.discover` released: the label as written, when the
 *   revision was created (through the dates formatter), its kind, whether it was the head at
 *   release and whether every analysis was ready. No figure, receipt, stale mark, total,
 *   hidden count, owner or Rebuild is invented for it; a what-if's figures appear only in the
 *   opened view, each from its embedded receipt. Labels may repeat; rows are distinct by both
 *   identities and nothing is ranked or summarised.
 * - "Next five" moves the window over the rows read so far, and from the last window reads
 *   the next page with the exact issued continuation. The page sentence counts rows read so
 *   far; it never states a total, and its two positions become text through the shared
 *   `format/` count formatter like every other number.
 * - A row names the exact rows, window and selection it was drawn beside; a page or
 *   continuation control names the exact rows, cursor, window and selection it was drawn
 *   beside. Replaced rows, a moved window or a newer selection leave them inert; the
 *   controller refuses them. Focus is captured and returned by the host for an accepted
 *   choice only, never by a refused press.
 * - A trusted host pin is shown alone, as before; the list then opens only on an explicit
 *   press. A refused chosen row has no pin to re-read: its rows and pin are gone with it, and
 *   the only next step offered is the fresh first page of the list.
 * - This screen holds no copy of the rows, performs no effect and never reads a receipt.
 */

import { useId, type ReactNode } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { PageHeader } from '../../app/PageHeader';
import { useLanguage, useT } from '../../app/text';
import { age, count } from '../../format/index.ts';
import type { RetainedScenarioState, ScenarioContinuation, ScenarioDiscoveryState, ScenarioRowOrigin } from '../../host/retained-controller.ts';
import { SCENARIO_PAGE_SIZE, discoveryRowSelection, isTransportUnavailable, sameScenarioSelection } from '../../host/retained-contracts.ts';
import type { RetainedScenarioView, ScenarioDiscoveryRow, ScenarioSelection } from '../../host/retained-contracts.ts';
import { Button } from '../../parts/Button';
import { RowList } from '../../parts/RowList';
import { State } from '../../patterns/States';
import { RetainedScenario, scenarioRefusalKey, type RetainedScenarioShown } from './RetainedScenario';
import s from './SavedScenarios.module.css';

/** The at-rest window: which rows read so far are on this page, and where it sits in them. */
export interface ScenarioPageWindow {
  readonly rows: readonly ScenarioDiscoveryRow[];
  /** One-based positions of the first and last row on this page among the rows read so far. */
  readonly from: number;
  readonly to: number;
  readonly last: number;
}
export function scenarioPageWindow(rows: readonly ScenarioDiscoveryRow[], page: number): ScenarioPageWindow {
  const last = Math.max(0, Math.ceil(rows.length / SCENARIO_PAGE_SIZE) - 1);
  const current = Math.min(Math.max(0, page), last), start = current * SCENARIO_PAGE_SIZE;
  const shown = rows.slice(start, start + SCENARIO_PAGE_SIZE);
  return { rows: shown, from: shown.length === 0 ? 0 : start + 1, to: start + shown.length, last };
}

/** The row identity on the list: both exact pins, so two revisions of one label never share a row. */
export const scenarioRowId = (pin: ScenarioSelection): string => JSON.stringify([pin.scenarioId, pin.revisionId]);
/** Graph readiness in a square: every analysis ready, or Chausar's work not finished. The words say which. */
const STATUS_MARK = { complete: 'cha', partial: 'busy' } as const;

/** The at-rest rows: the label as written, then when it was created, its kind, its head description and its readiness. */
export function useScenarioRows(rows: readonly ScenarioDiscoveryRow[]): ReadonlyArray<RowItem> {
  const t = useT();
  const language = useLanguage();
  return rows.map((row) => ({
    id: scenarioRowId(row),
    mark: STATUS_MARK[row.status],
    markWordsKey: `RETAINED.saved.status.${row.status}`,
    what: row.label,
    note: t('RETAINED.saved.row', {
      when: age(row.createdAt, t('RETAINED.saved.created'), language), mode: t(`RETAINED.saved.mode.${row.revisionMode}`),
      head: t(row.isHead ? 'RETAINED.saved.head.current' : 'RETAINED.saved.head.earlier'), status: t(`RETAINED.saved.status.${row.status}`),
    }),
  }));
}

/** Whether the shown what-if is the row chosen from the list (drawn in the sheet), rather than the trusted pin shown alone. */
export function chosenFromList(discovery: ScenarioDiscoveryState, scenario: RetainedScenarioState): boolean {
  return discovery.kind === 'ready' && discovery.selected !== null && scenario.kind !== 'idle' && sameScenarioSelection(discovery.selected, scenario.selection);
}

export interface SavedScenariosProps {
  discovery: ScenarioDiscoveryState;
  scenario: RetainedScenarioState;
  /** Whether the trusted mount supplied an exact pin: it is shown alone and the list opens only on an explicit press. */
  trustedPin: boolean;
  /** Whether this surface is at rest (no sheet open), so an idle list is about to be read. */
  atRest: boolean;
  /** An explicit fresh first page of the list. */
  onOverview: () => void;
  /** The next page with the exact issued cursor, from the exact rows, window and selection the control was drawn beside. */
  onContinue: (origin: ScenarioContinuation) => void;
  /** Moves the at-rest window over the exact rows read so far, from the exact window and selection the control was drawn beside. */
  onPage: (rows: readonly ScenarioDiscoveryRow[], from: number, page: number, selection: ScenarioSelection | null) => void;
  /** One human choice: both exact identities of the pressed row, the control pressed and the exact origin it was drawn beside. */
  onOpen: (selection: ScenarioSelection, origin: HTMLElement, binding: ScenarioRowOrigin) => void;
  /** A fresh reopen of the trusted pin shown alone, naming the exact pin and view the control was drawn for. */
  onReadAgain: (shown: RetainedScenarioShown) => void;
  onProof: (runId: string, origin: HTMLElement | null, view: RetainedScenarioView) => void;
  onProvenance: (origin: HTMLElement | null, view: RetainedScenarioView) => void;
  /** The existing return to the previous interface, kept under this surface. */
  legacy?: ReactNode;
}

function Rows({ state, onOpen, onPage, onContinue, onOverview }: {
  state: Extract<ScenarioDiscoveryState, { kind: 'ready' }>;
  onOpen: SavedScenariosProps['onOpen']; onPage: SavedScenariosProps['onPage']; onContinue: SavedScenariosProps['onContinue']; onOverview: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const shown = scenarioPageWindow(state.rows, state.page);
  const rows = useScenarioRows(shown.rows);
  const current = Math.min(state.page, shown.last);
  const atLast = current >= shown.last;
  const open = (id: string, origin: HTMLElement) => {
    const row = shown.rows.find((item) => scenarioRowId(item) === id);
    if (row !== undefined) onOpen(discoveryRowSelection(row), origin, { rows: state.rows, page: current, from: state.selected });
  };
  // Within the rows read so far the window moves locally; from the last window the exact issued cursor reads the next page.
  // Either control names the exact rows, window and selection it was drawn beside.
  const later = () => {
    if (!atLast) onPage(state.rows, current, current + 1, state.selected);
    else if (state.cursor !== null) onContinue({ rows: state.rows, cursor: state.cursor, page: current, from: state.selected });
  };
  return (
    <section className={s.group} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.heading}>{t('RETAINED.saved.title')}</h2>
      <p className={s.note}>{t('RETAINED.saved.note')}</p>
      {state.rows.length === 0 ? (
        <p className={s.text}>{t('RETAINED.saved.empty')}</p>
      ) : (
        <RowList rows={rows} labelledBy={titleId} selectedId={state.selected === null ? undefined : scenarioRowId(state.selected)} onOpen={open} onReceipt={() => {}} />
      )}
      {(state.rows.length > SCENARIO_PAGE_SIZE || state.cursor !== null) && (
        <div className={s.actions}>
          {/* The two positions are UI bookkeeping over the rows read so far, never a total; like every number they become text only through format/. */}
          <p className={s.note}>{t('RETAINED.saved.page', { from: count(String(shown.from)), to: count(String(shown.to)) })}</p>
          <Button variant="link" disabled={current === 0} onClick={() => onPage(state.rows, current, current - 1, state.selected)}>{t('RETAINED.saved.pageEarlier')}</Button>
          <Button variant="link" disabled={atLast && state.cursor === null} onClick={later}>{t('RETAINED.saved.pageLater')}</Button>
        </div>
      )}
      {atLast && state.cursor !== null && <p className={s.note}>{t('RETAINED.saved.more')}</p>}
      <div className={s.actions}><Button variant="link" onClick={onOverview}>{t('RETAINED.saved.readAgain')}</Button></div>
    </section>
  );
}

function Overview({ discovery, scenario, trustedPin, atRest, onOverview, refused, ...rows }: Pick<SavedScenariosProps, 'discovery' | 'scenario' | 'trustedPin' | 'atRest' | 'onOverview' | 'onOpen' | 'onPage' | 'onContinue'> & {
  /** Whether a refused chosen row already offers the fresh list beneath this overview. */
  refused: boolean;
}) {
  const t = useT();
  if (discovery.kind === 'ready') return <Rows state={discovery} onOpen={rows.onOpen} onPage={rows.onPage} onContinue={rows.onContinue} onOverview={onOverview} />;
  if (discovery.kind === 'loading') return <p role="status" className={s.text}>{t('RETAINED.saved.loading')}</p>;
  if (discovery.kind === 'unavailable') {
    // A stale continuation names its refusal; a withdrawn capability is honest missing capability, never an empty list.
    const what = discovery.code === 'SCENARIO_AUTHORITY_CHANGED' ? 'RETAINED.saved.changed'
      : isTransportUnavailable(discovery.code) ? 'RETAINED.scenario.noDiscovery' : 'RETAINED.saved.unavailable';
    return <State state={{ kind: 'failed', code: discovery.code, what: t(what) }} action={{ label: t('RETAINED.saved.readAgain'), onPress: onOverview }} />;
  }
  // Idle. A trusted pin or a shown what-if: the list opens on an explicit press only. A refused chosen row offers the
  // fresh list itself. At rest with nothing shown the surface's own read is starting; behind a sheet nothing is read.
  if (refused) return null;
  if (trustedPin || scenario.kind !== 'idle') return <div className={s.actions}><Button variant="link" onClick={onOverview}>{t('RETAINED.saved.show')}</Button></div>;
  return atRest ? <p role="status" className={s.text}>{t('RETAINED.saved.loading')}</p> : null;
}

export function SavedScenarios({ discovery, scenario, trustedPin, atRest, onOverview, onContinue, onPage, onOpen, onReadAgain, onProof, onProvenance, legacy }: SavedScenariosProps) {
  const t = useT();
  const chosen = chosenFromList(discovery, scenario);
  // A refusal with no pin to re-read: a chosen row's ephemeral pin went with its rows, or the trusted pin was malformed.
  // Nothing is re-read or rescued from a static option; the only next step is an explicit fresh first page, without a cursor.
  const refused = scenario.kind === 'unavailable' && scenario.selection === null ? scenario : null;
  return (
    <section className={s.page} aria-label={t('SH-01.sub.ask.saved')}>
      <PageHeader where={t('SH-01.place.ask')} title={t('SH-01.sub.ask.saved')} />
      <Overview discovery={discovery} scenario={scenario} trustedPin={trustedPin} atRest={atRest} onOverview={onOverview} refused={refused !== null}
        onOpen={onOpen} onPage={onPage} onContinue={onContinue} />
      {refused !== null ? (
        <State state={{ kind: 'failed', code: refused.code, what: t(refused.code === 'SCENARIO_AUTHORITY_CHANGED' ? 'RETAINED.saved.changed' : scenarioRefusalKey(refused.code)) }}
          action={{ label: t('RETAINED.saved.readAgain'), onPress: onOverview }} />
      ) : scenario.kind !== 'idle' && !chosen ? (
        // The trusted host pin, shown alone in the page as before; a chosen row is drawn by the host in the one right sheet.
        <RetainedScenario state={scenario} onRead={onReadAgain} onProof={onProof} onProvenance={onProvenance} />
      ) : null}
      {legacy}
    </section>
  );
}
