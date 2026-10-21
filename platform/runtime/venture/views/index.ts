// Chausar venture launcher, views for the Ink frontend (P1-A): Today's queue, runs and the team. The host loads this
// file on first use of a method it owns. Each view is read from records other packages keep; a decision on a row runs
// the engine method that does the real thing.
import type { VentureHandlerTable } from '../contracts.ts';
import { queueDecideHandler, queueListHandler } from './queue.ts';
import { runsGetHandler, runsListHandler } from './runs.ts';
import { teamGateHandler, teamListHandler } from './team.ts';

export const handlers: VentureHandlerTable = {
  'venture.queue.list': queueListHandler,
  'venture.queue.decide': queueDecideHandler,
  'venture.runs.list': runsListHandler,
  'venture.runs.get': runsGetHandler,
  'venture.team.list': teamListHandler,
  'venture.team.gate': teamGateHandler,
};

export { questionRowId } from './queue.ts';
export { floorReason } from './team.ts';
