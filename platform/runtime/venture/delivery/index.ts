// Chausar venture launcher, delivery package (P5): playbook, draft replies, rehearsal, launch ladder,
// real delivery runs and the capability list. The host loads this file on first use of a method it owns.
import type { VentureHandlerTable } from '../contracts.ts';
import { capabilitiesHandler } from './capabilities.ts';
import { filesAddHandler, filesListHandler } from './harness/files.ts';
import { workGetHandler } from './harness/work-get.ts';
import { improveAdoptHandler, improveGetHandler, improveRunHandler, improveStatusHandler } from './improve.ts';
import { launchAdvanceHandler, launchStatusHandler } from './launch.ts';
import { playbookHandler } from './playbook.ts';
import { deliveryAnswerHandler, deliveryApproveHandler, deliveryListHandler, deliveryReviewHandler, deliveryRunHandler } from './runs.ts';
import { simulationFromSignalHandler, simulationGetHandler, simulationRunHandler, simulationScenariosHandler } from './simulate.ts';

export const handlers: VentureHandlerTable = {
  'venture.delivery.playbook': playbookHandler,
  'venture.simulation.scenarios': simulationScenariosHandler,
  'venture.simulation.run': simulationRunHandler,
  'venture.simulation.get': simulationGetHandler,
  'venture.simulation.fromSignal': simulationFromSignalHandler,
  'venture.launch.status': launchStatusHandler,
  'venture.launch.advance': launchAdvanceHandler,
  'venture.delivery.run': deliveryRunHandler,
  'venture.delivery.approve': deliveryApproveHandler,
  'venture.delivery.review': deliveryReviewHandler,
  'venture.delivery.list': deliveryListHandler,
  'venture.capabilities': capabilitiesHandler,
  'venture.files.add': filesAddHandler,
  'venture.files.list': filesListHandler,
  'venture.delivery.answer': deliveryAnswerHandler,
  'venture.work.get': workGetHandler,
  'venture.improve.status': improveStatusHandler,
  'venture.improve.run': improveRunHandler,
  'venture.improve.get': improveGetHandler,
  'venture.improve.adopt': improveAdoptHandler,
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
