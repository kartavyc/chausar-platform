// Chausar venture launcher, views for the Ink frontend (P1-A): Today's queue, runs and the team. The host loads this
// file on first use of a method it owns. Each view is read from records other packages keep; a decision on a row runs
// the engine method that does the real thing.
import type { VentureHandlerTable } from '../contracts.ts';
import { queueDecideHandler, queueListHandler } from './queue.ts';
import { runsGetHandler, runsListHandler } from './runs.ts';
import { teamGateHandler, teamListHandler, teamPostureHandler } from './team.ts';
import { journalListHandler, journalResolveHandler } from '../journal/list.ts';
import { untrustedModeHandler, untrustedReleaseHandler } from '../policy/untrusted-methods.ts';
import { queueViewHandler } from './queue-view.ts';
import { caConfirmRates, caExplainDiff, caGet, caReceipt, caRecordSignoff, caSetOfRecord } from '../playbooks/ca-firm/methods.ts';
import { rulesListHandler } from '../playbooks/rules-view.ts';

export const handlers: VentureHandlerTable = {
  'venture.queue.list': queueListHandler,
  'venture.queue.decide': queueDecideHandler,
  'venture.runs.list': runsListHandler,
  'venture.runs.get': runsGetHandler,
  'venture.team.list': teamListHandler,
  'venture.team.gate': teamGateHandler,
  // The action journal (P2-journal) is a view over the journalled records: entries, posts and website edits.
  'venture.journal.list': journalListHandler,
  // Resolve on an unknown outcome: the owner records what they found; nothing is sent again (W1 H3).
  'venture.journal.resolve': journalResolveHandler,
  // The untrusted screen's rollout (W1 H9): the business's screen mode, and the owner releasing one held content.
  'venture.untrusted.mode': untrustedModeHandler,
  'venture.untrusted.release': untrustedReleaseHandler,
  // Ink final pass: what a Today row is about, and an agent's own posture.
  'venture.queue.view': queueViewHandler,
  'venture.team.posture': teamPostureHandler,
  // The AI-native CA firm (playbooks/ca-firm/methods.ts): the CA of record, rate confirmations and sign-offs.
  'venture.ca.get': caGet,
  'venture.ca.setOfRecord': caSetOfRecord,
  'venture.ca.recordSignoff': caRecordSignoff,
  'venture.ca.confirmRates': caConfirmRates,
  // Ink v2 wave 2: stored CA receipts and portal differences (2A2), and the dated platform rules (2H).
  'venture.ca.receipt': caReceipt,
  'venture.ca.explainDiff': caExplainDiff,
  'venture.rules.list': rulesListHandler,
};

export { questionRowId } from './queue.ts';
export { floorReason } from './team.ts';
