// Chausar venture launcher, delivery package (P5): playbook, draft replies, rehearsal, launch ladder
// and real delivery runs. The host loads this file on first use of a method it owns.
import { ChausarError } from '../../contracts.ts';
import { decideAgentApproval } from '../agent-runtime/approvals.ts';
import type { VentureHandler, VentureHandlerTable } from '../contracts.ts';
import { filesAddHandler, filesListHandler, filesTranscribeHandler } from './harness/files.ts';
import { workGetHandler } from './harness/work-get.ts';
import { improveAdoptHandler, improveRollbackHandler, improveRunHandler, improveStatusHandler } from './improve.ts';
import { deliveryJudgeHandler, deliveryJudgeSendHandler, judgeAutoGetHandler, judgeAutoSetHandler, withJudgeNotices } from './judge-run.ts';
import { launchAdvanceHandler, launchStatusHandler } from './launch.ts';
import { playbookHandler } from './playbook.ts';
import { playbookGuidanceHandler } from './guidance-report.ts';
import { drillsListHandler, drillsRunHandler } from './drills.ts';
import { deliveryListHandler, deliveryReviewHandler, deliveryRunHandler } from './runs.ts';
import { simulationRunHandler, simulationScenariosHandler } from './simulate.ts';
import { transcriptionGetHandler, transcriptionSetHandler } from '../playbooks/youtube/transcribe.ts';

type RunMethod = 'venture.delivery.run';
/** A delivery method's run, as the screens read it, with the judge's notice when its write turn waits (judge-run.ts). */
const noticed = <M extends RunMethod>(handler: VentureHandler<M>): VentureHandler<M> => async (deps, ctx, payload) => withJudgeNotices(deps, ctx, [await handler(deps, ctx, payload)])[0];
/** A wave 4 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

export const handlers: VentureHandlerTable = {
  'venture.agentApproval.decide': decideAgentApproval,
  'venture.delivery.playbook': playbookHandler,
  'venture.simulation.scenarios': simulationScenariosHandler,
  'venture.simulation.run': simulationRunHandler,
  'venture.launch.status': launchStatusHandler,
  'venture.launch.advance': launchAdvanceHandler,
  'venture.delivery.run': noticed(deliveryRunHandler),
  'venture.delivery.review': deliveryReviewHandler,
  'venture.delivery.list': async (deps, ctx, payload) => withJudgeNotices(deps, ctx, await deliveryListHandler(deps, ctx, payload)),
  'venture.files.add': filesAddHandler,
  'venture.files.list': filesListHandler,
  'venture.work.get': workGetHandler,
  'venture.improve.status': improveStatusHandler,
  'venture.improve.run': improveRunHandler,
  'venture.improve.adopt': improveAdoptHandler,
  // Ink v2 wave 2: the judge on real orders and going back a playbook version (2C1), a transcript made here (2E2).
  'venture.delivery.judge': deliveryJudgeHandler,
  'venture.delivery.judgeSend': deliveryJudgeSendHandler,
  'venture.improve.rollback': improveRollbackHandler,
  'venture.judge.auto.get': judgeAutoGetHandler,
  'venture.judge.auto.set': judgeAutoSetHandler,
  'venture.files.transcribe': filesTranscribeHandler,
  'venture.transcription.get': transcriptionGetHandler,
  'venture.transcription.set': transcriptionSetHandler,
  // Ink v2 wave 4 (package 4-0 registered these; each package replaces its own lines). 4J2 fixes and draft changes.
  'venture.delivery.fix': async (deps, ctx, payload) => (await import('./revise.ts')).deliveryFixHandler(deps, ctx, payload),
  'venture.delivery.decideChange': async (deps, ctx, payload) => (await import('./changes.ts')).decideChangeHandler(deps, ctx, payload),
  'venture.delivery.changes': async (deps, ctx, payload) => (await import('./changes.ts')).deliveryChangesHandler(deps, ctx, payload),
  // 4J2 review: Make a copy of a draft that went out.
  'venture.delivery.copy': async (deps, ctx, payload) => (await import('./copy.ts')).deliveryCopyHandler(deps, ctx, payload),
  // 4J15 drills; 4J16 the guidance report.
  'venture.drills.run': drillsRunHandler,
  'venture.drills.list': drillsListHandler,
  'venture.playbook.guidance': playbookGuidanceHandler,
};

// For tests and the other screens' fixtures.
export { runChecks } from './checks.ts';
export { deliveryTask, renderDeliverable, renderForJudge, templateOutline, validateDraft } from './deliverable.ts';
export { computeLaunchStatus } from './launch.ts';
export { playbookSteps, validatePlaybook } from './playbook.ts';
export { compileRowProgram } from './harness/sandbox-wasm.ts';
export { interpretRow, parseRowProgram } from './harness/sandbox-lang.ts';
export { reconcileMonth, sumRows, totalsBy } from './harness/work.ts';
export { scenariosFor, signalScenario } from './scenarios.ts';
