/**
 * RetainedPlace: the composition of the two retained-reader surfaces by address.
 *   ask / saved           SavedScenarios: the released what-if ledger (and the exact trusted host
 *                         pin, shown alone in the page); the what-if chosen from the ledger is
 *                         drawn by the host beside the stationary list, in the one right sheet
 *   reports / weekahead   LessonReview (the Friday review's proposed lessons)
 *   work / approvals      LessonReview (which lessons become personal guidance)
 * Any other address is not this slice's: the host keeps its existing fallback. The surface
 * starts one fresh read when it is shown at rest and the controller is idle; it owns no data
 * and no transport, and it never persists or recomputes anything.
 *
 * On Saved, a trusted host pin is reopened at rest exactly as before and the list then opens
 * only on an explicit press; without a pin the released rows are read at rest. Neither read
 * chooses a row: a what-if opens only from a human press on the exact checked row, through the
 * host's own intent, which also leaves any saved-answer readback. Every list control (a row, a
 * window, a continuation, the overview) is the host's intent too, because the host owns the
 * chosen row's sheet beside the list and the live address those controls act for.
 *
 * Every read, whether started by an effect or by a press, is fenced by the host's `live` check
 * for this exact address, both before it starts and at every awaited boundary inside the
 * controller: after a same-batch route change, Help, lock or context invalidation an obsolete
 * still-connected control dispatches nothing, and a held reply that returns after an actual
 * hash departure, before React has committed it, publishes nothing. A surface behind an open
 * sheet never revives itself; returning to it at rest requires the fresh read.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Address } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import type { RetainedScenarioView, ScenarioDiscoveryRow, ScenarioSelection } from '../../host/retained-contracts.ts';
import type { RetainedController, ScenarioContinuation, ScenarioRowOrigin } from '../../host/retained-controller.ts';
import type { RetainedScenarioShown } from '../ask/RetainedScenario';
import { SavedScenarios } from '../ask/SavedScenarios';
import { LessonReviewList, type LessonRowOrigin } from '../reports/LessonReview';

export type RetainedSurface = 'scenario' | 'lessons';

/** Which retained surface an address names, by place and sub-place only. */
export function retainedSurface(address: Address): RetainedSurface | null {
  // Ask, What-ifs is the released what-ifs' own address; Saved shows them only where no lane's place module draws it.
  if (address.place === 'ask' && (address.sub === 'whatifs' || address.sub === 'saved')) return 'scenario';
  // Reports, Lessons is the lessons' own address (the Friday review's proposed lessons). Week ahead and
  // Approvals show them only where no lane's place module draws that address.
  if (address.place === 'reports' && address.sub === 'lessons') return 'lessons';
  if ((address.place === 'reports' && address.sub === 'weekahead') || (address.place === 'work' && address.sub === 'approvals')) return 'lessons';
  return null;
}

export interface RetainedPlaceProps {
  address: Address;
  retained: RetainedController;
  /** The exact pin the trusted mount supplied, unchecked here; null when none was supplied. */
  scenarioSelection: unknown;
  /** Whether this exact address is still the live authorized surface at the moment of a press or an effect. */
  live: (address: Address) => boolean;
  /** Opens one released what-if row: both exact identities, the pressed control and the exact rows, window and selection it was drawn beside. */
  onOpenScenario: (selection: ScenarioSelection, origin: HTMLElement, binding: ScenarioRowOrigin) => void;
  /** An explicit fresh first page of the released what-ifs. */
  onOverview: () => void;
  /** The next page from the exact rows, cursor, window and selection the control was drawn beside. */
  onContinueScenarios: (origin: ScenarioContinuation) => void;
  /** Moves the at-rest window from the exact rows, window and selection the control was drawn beside. */
  onPageScenarios: (rows: readonly ScenarioDiscoveryRow[], from: number, page: number, selection: ScenarioSelection | null) => void;
  /** Opens the proof behind a figure of the exact rendered view the control belongs to. */
  onProof: (runId: string, origin: HTMLElement | null, view: RetainedScenarioView) => void;
  onProvenance: (origin: HTMLElement | null, view: RetainedScenarioView) => void;
  /** Opens a lesson row: the exact candidate id, the pressed control and the exact rendered list, page and selection it came from. */
  onOpenLesson: (id: string, origin: HTMLElement, from: LessonRowOrigin) => void;
  legacy?: ReactNode;
}

export function RetainedPlace({ address, retained, scenarioSelection, live, onOpenScenario, onOverview, onContinueScenarios, onPageScenarios, onProof, onProvenance, onOpenLesson, legacy }: RetainedPlaceProps) {
  const t = useT();
  const state = useSyncExternalStore(retained.subscribe, retained.snapshot, retained.snapshot);
  const surface = retainedSurface(address);
  const atRest = address.sheet === undefined;
  const selectionSupplied = scenarioSelection !== null && scenarioSelection !== undefined;
  const scenarioIdle = state.scenario.kind === 'idle', discoveryIdle = state.discovery.kind === 'idle', lessonsIdle = state.lessons.kind === 'idle';
  // The trusted pin opens at rest as before, but never over a list a person opened or a what-if chosen from it.
  useEffect(() => {
    if (surface === 'scenario' && atRest && selectionSupplied && scenarioIdle && discoveryIdle && live(address)) void retained.openScenario(scenarioSelection, () => live(address));
  }, [surface, atRest, selectionSupplied, scenarioIdle, discoveryIdle, retained, scenarioSelection, live, address]);
  // Without a pin the released rows are read at rest; a refused what-if is never silently replaced by a new list.
  useEffect(() => {
    if (surface === 'scenario' && atRest && !selectionSupplied && discoveryIdle && scenarioIdle && live(address)) void retained.readDiscovery(() => live(address));
  }, [surface, atRest, selectionSupplied, discoveryIdle, scenarioIdle, retained, live, address]);
  useEffect(() => {
    if (surface === 'lessons' && atRest && lessonsIdle && live(address)) void retained.readLessons(() => live(address));
  }, [surface, atRest, lessonsIdle, retained, live, address]);

  if (surface === 'scenario') {
    // The trusted pin shown alone is read again from exactly the pin and view the control named; a refused chosen row
    // reaches no control here (its pin went with its rows), and no static option rescues it.
    const readAgain = (shown: RetainedScenarioShown) => { if (live(address)) void retained.readScenarioAgain({ ...shown, list: null }, () => live(address)); };
    return <SavedScenarios discovery={state.discovery} scenario={state.scenario} trustedPin={selectionSupplied} atRest={atRest}
      onOverview={onOverview} onContinue={onContinueScenarios} onPage={onPageScenarios} onOpen={onOpenScenario} onReadAgain={readAgain}
      onProof={onProof} onProvenance={onProvenance} legacy={legacy} />;
  }
  if (surface === 'lessons') {
    const approvals = address.place === 'work';
    return <LessonReviewList state={state.lessons} where={t(approvals ? 'SH-01.place.work' : 'SH-01.place.reports')}
      title={t(approvals ? 'SH-01.sub.work.approvals' : address.sub === 'lessons' ? 'SH-01.sub.reports.lessons' : 'SH-01.sub.reports.weekahead')}
      onRead={() => { if (live(address)) void retained.readLessons(() => live(address)); }}
      onOpen={onOpenLesson}
      onPage={(list, from, page) => { if (live(address)) retained.pageLessons(list, from, page); }}
      legacy={legacy} />;
  }
  return null;
}
