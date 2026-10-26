// Chausar venture launcher, views for the Ink frontend (P1-A): Today's queue, runs and the team. The host loads this
// file on first use of a method it owns. Each view is read from records other packages keep; a decision on a row runs
// the engine method that does the real thing.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';
import { queueDecideHandler, queueListHandler } from './queue.ts';
import { runsGetHandler, runsListHandler } from './runs.ts';
import { teamClearQuarantineHandler, teamGateHandler, teamListHandler, teamPostureHandler } from './team.ts';
import { teamKeeperHandler } from './keeper.ts';
import { journalListHandler, journalResolveHandler } from '../journal/list.ts';
import { untrustedModeHandler, untrustedReleaseHandler } from '../policy/untrusted-methods.ts';
import { queueViewHandler } from './queue-view.ts';
import { caConfirmRates, caExplainDiff, caGet, caReceipt, caRecordSignoff, caSetOfRecord } from '../playbooks/ca-firm/methods.ts';
import { rulesListHandler } from '../playbooks/rules-view.ts';
import { businessPauseHandler, runsResumeHandler, runsRoundGateHandler, runsSteerHandler, runsStopHandler } from '../delivery/run-controls.ts';
import { awayGetHandler, awaySetHandler } from '../delivery/away.ts';
import { runsAllowWritesHandler } from '../delivery/harness/write-caps.ts';
import { decisionsListHandler } from '../journal/decisions.ts';
import { allowSessionHandler } from '../policy/allow-session.ts';
import { journalAcceptBreakHandler, journalChainHandler } from '../journal/chain.ts';
import { runsAcross } from './across.ts';
import { autoReadinessHandler } from '../policy/auto-gate.ts';
import { shadowSummaryHandler } from '../delivery/shadow-summary.ts';
import { queueEditHandler, queueSendBackHandler, queueSetHandler, queueSetPreviewHandler, queueUndoHandler } from './queue-actions.ts';
import { triagePreviewHandler, triageSetHandler } from './triage.ts';

/** A wave 4 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

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
  // Ink v2 wave 4 (package 4-0 registered these; each package replaces its own lines). 4A1 Keeper and health.
  'venture.team.keeper': teamKeeperHandler,
  'venture.team.clearQuarantine': teamClearQuarantineHandler,
  // 4F1 run controls, pause all and Away; 4F2 the write caps.
  'venture.runs.stop': runsStopHandler,
  'venture.runs.resume': runsResumeHandler,
  'venture.runs.roundGate': runsRoundGateHandler,
  'venture.runs.steer': runsSteerHandler,
  'venture.business.pause': businessPauseHandler,
  'venture.away.set': awaySetHandler,
  'venture.away.get': awayGetHandler,
  'venture.runs.allowWrites': runsAllowWritesHandler,
  // 4J1 decisions and allow for this session.
  'venture.decisions.list': decisionsListHandler,
  'venture.policy.allowSession': allowSessionHandler,
  // 4J2 send back, edit and undo, set approval, the triage rule.
  'venture.queue.sendBack': queueSendBackHandler,
  'venture.queue.edit': queueEditHandler,
  'venture.queue.undo': queueUndoHandler,
  'venture.queue.set': queueSetHandler,
  'venture.queue.setPreview': queueSetPreviewHandler, // 4J2 review
  'venture.triage.set': triageSetHandler,
  'venture.triage.preview': triagePreviewHandler,
  // 4J6 runs across businesses; 4J10 the chained journal; 4J15 auto readiness and the shadow summary.
  'venture.runs.across': runsAcross,
  'venture.journal.chain': journalChainHandler,
  'venture.journal.acceptBreak': journalAcceptBreakHandler,
  'venture.auto.readiness': autoReadinessHandler,
  'venture.shadow.summary': shadowSummaryHandler,
};

export { questionRowId } from './queue.ts';
export { floorReason } from './team.ts';
