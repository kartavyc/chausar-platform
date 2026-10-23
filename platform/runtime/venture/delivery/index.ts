// Chausar venture launcher, delivery package (P5): playbook, draft replies, rehearsal, launch ladder,
// real delivery runs and the capability list. The host loads this file on first use of a method it owns.
import type { VentureHandler, VentureHandlerTable } from '../contracts.ts';
import { capabilitiesHandler } from './capabilities.ts';
import { filesAddHandler, filesListHandler, filesTranscribeHandler } from './harness/files.ts';
import { delegateGetHandler } from './harness/delegate-get.ts';
import { workGetHandler } from './harness/work-get.ts';
import { improveAdoptHandler, improveGetHandler, improveRollbackHandler, improveRunHandler, improveStatusHandler } from './improve.ts';
import { deliveryJudgeHandler, deliveryJudgeSendHandler, judgeAutoGetHandler, judgeAutoSetHandler, withJudgeNotices } from './judge-run.ts';
import { launchAdvanceHandler, launchStatusHandler } from './launch.ts';
import { playbookHandler } from './playbook.ts';
import { deliveryAnswerHandler, deliveryApproveHandler, deliveryDelegateHandler, deliveryListHandler, deliveryReviewHandler, deliveryRunHandler } from './runs.ts';
import { simulationFromSignalHandler, simulationGetHandler, simulationRunHandler, simulationScenariosHandler } from './simulate.ts';
import { transcriptionGetHandler, transcriptionSetHandler } from '../playbooks/youtube/transcribe.ts';

type RunMethod = 'venture.delivery.run' | 'venture.delivery.approve' | 'venture.delivery.answer' | 'venture.delivery.delegate';
/** A delivery method's run, as the screens read it, with the judge's notice when its write turn waits (judge-run.ts). */
const noticed = <M extends RunMethod>(handler: VentureHandler<M>): VentureHandler<M> => async (deps, ctx, payload) => withJudgeNotices(deps, ctx, [await handler(deps, ctx, payload)])[0];

export const handlers: VentureHandlerTable = {
  'venture.delivery.playbook': playbookHandler,
  'venture.simulation.scenarios': simulationScenariosHandler,
  'venture.simulation.run': simulationRunHandler,
  'venture.simulation.get': simulationGetHandler,
  'venture.simulation.fromSignal': simulationFromSignalHandler,
  'venture.launch.status': launchStatusHandler,
  'venture.launch.advance': launchAdvanceHandler,
  'venture.delivery.run': noticed(deliveryRunHandler),
  'venture.delivery.approve': noticed(deliveryApproveHandler),
  'venture.delivery.review': deliveryReviewHandler,
  'venture.delivery.list': async (deps, ctx, payload) => withJudgeNotices(deps, ctx, await deliveryListHandler(deps, ctx, payload)),
  'venture.capabilities': capabilitiesHandler,
  'venture.files.add': filesAddHandler,
  'venture.files.list': filesListHandler,
  'venture.delivery.answer': noticed(deliveryAnswerHandler),
  'venture.delivery.delegate': noticed(deliveryDelegateHandler),
  'venture.delegate.get': delegateGetHandler,
  'venture.work.get': workGetHandler,
  'venture.improve.status': improveStatusHandler,
  'venture.improve.run': improveRunHandler,
  'venture.improve.get': improveGetHandler,
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
};

// For tests and the other screens' fixtures.
export { capabilityList } from './capabilities.ts';
export { runChecks } from './checks.ts';
export { deliveryTask, renderDeliverable, renderForJudge, templateOutline, validateDraft } from './deliverable.ts';
export { computeLaunchStatus } from './launch.ts';
export { playbookSteps, validatePlaybook } from './playbook.ts';
export { compileRowProgram } from './harness/sandbox-wasm.ts';
export { interpretRow, parseRowProgram } from './harness/sandbox-lang.ts';
export { reconcileMonth, sumRows, totalsBy } from './harness/work.ts';
export { scenariosFor, signalScenario } from './scenarios.ts';
