/**
 * From an engine reply to what Today draws.
 *
 * There is one checked projection, and it is not here: `projectTodayForUi` in
 * bridge/project-ui.ts (owned by the bridge lane) validates the reply, formats every
 * exact value through the format module, keeps every figure label, keeps the change as
 * a figure with its receipt, keeps an unknown count as unknown, and gives every stat an
 * explicit chart state. This file only names its result in the screen's own types.
 *
 * The assignment to `TodayData` below is plain: no cast and no conversion. It compiles
 * only while the component DTOs and the projection agree, which is the check that the
 * two lanes have not drifted. Nothing here formats, drops, defaults or rebuilds a field.
 *
 * The action maps stay separate from the data, as the projection returns them: a row or
 * a day mark carries no address, and the controller resolves a press by its id.
 */

import { projectTodayForUi, type UIChartState, type UIFormatContext } from '../../bridge/project-ui.ts';
import type { OpenSheetIntent } from '../../bridge/presentation.ts';
import type { TodayData } from './TodayData.ts';

export type ProjectionContext = UIFormatContext;

export interface TodayFromView {
  /** The supplied title, kept even though the screen draws its own fixed one. */
  readonly title: string;
  readonly data: TodayData;
  /** What opening a row means, by row id. A row absent from this list opens nothing. */
  readonly rowActions: ReadonlyArray<{ readonly rowId: string; readonly intent: OpenSheetIntent }>;
  /** What opening a day mark means, by event id. */
  readonly dayActions: ReadonlyArray<{ readonly eventId: string; readonly intent: OpenSheetIntent }>;
  /** Each stat's chart, or the reason it has none. The tiles carry the same state. */
  readonly chartStates: ReadonlyArray<{ readonly statId: string; readonly state: UIChartState }>;
}

/** The Today screen's data from a raw reply. The reply is validated inside the checked
 *  projection; a corrupt one throws there and nothing partial is returned. */
export function projectToday(raw: unknown, context: ProjectionContext): TodayFromView {
  const projected = projectTodayForUi(raw, context);
  const data: TodayData = projected.data;
  return {
    title: projected.title,
    data,
    rowActions: projected.rowActions,
    dayActions: projected.dayActions,
    chartStates: projected.chartStates,
  };
}

/** The intent for a row or a day mark, by id, from the separate action lists. */
export function intentFor(actions: ReadonlyArray<{ readonly rowId: string; readonly intent: OpenSheetIntent }>, rowId: string): OpenSheetIntent | undefined {
  return actions.find((a) => a.rowId === rowId)?.intent;
}

export function dayIntentFor(actions: ReadonlyArray<{ readonly eventId: string; readonly intent: OpenSheetIntent }>, eventId: string): OpenSheetIntent | undefined {
  return actions.find((a) => a.eventId === eventId)?.intent;
}
