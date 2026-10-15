// Chausar venture launcher, delivery package (P5): playbook, draft replies, rehearsal, launch ladder,
// real delivery runs and the capability list. The host loads this file on first use of a method it owns.
import type { VentureHandlerTable } from '../contracts.ts';
import { capabilitiesHandler } from './capabilities.ts';
import { launchAdvanceHandler, launchStatusHandler } from './launch.ts';
import { playbookHandler } from './playbook.ts';
import { deliveryApproveHandler, deliveryListHandler, deliveryReviewHandler, deliveryRunHandler } from './runs.ts';
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
};

// For tests and the other screens' fixtures.
export { capabilityList } from './capabilities.ts';
export { runChecks } from './checks.ts';
export { deliveryTask, renderDeliverable, renderForJudge, templateOutline, validateDraft } from './deliverable.ts';
export { computeLaunchStatus } from './launch.ts';
export { playbookSteps, validatePlaybook } from './playbook.ts';
export { scenariosFor, signalScenario } from './scenarios.ts';
