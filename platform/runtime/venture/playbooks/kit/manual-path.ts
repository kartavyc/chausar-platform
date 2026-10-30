// Chausar playbook kit: manual paths (Ink v2 wave 5, package 5A3; catalogue P5). Each step that needs outside data
// names its connector; while that connector is only planned (waiting on an app review, a partner programme or a
// verified provider), the playbook names, beside it, what a person does by hand meanwhile: "Until then: in Search
// Console open Performance, choose Export, and add the CSV to the order." The line goes into the step's task guidance
// (what the agent reads, so it asks for the export instead of pretending to fetch it) and onto the order card (what
// the owner reads). Nothing is faked: a planned connector never runs. Code only.
//
// Idea taken, code written here: finance-skills references/查询路径.md (the query paths a person follows by hand
// beside each data source), read for the idea only.
import { check } from '../../../contracts.ts';
import type { KitConnector, KitStep, PlaybookDefinition } from './define.ts';

/** How every manual path line starts. */
export const MANUAL_PATH_LEAD = 'Until then: ';

/** What the order card shows for one stage that needs a planned connector. */
export type ManualPathView = { step: string; connector: string; waitsOn: string; line: string };

const planned = (connector: KitConnector) => connector.label.startsWith('planned:');
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * The manual path as one line, "Until then: ..." with the path's first word in lower case when it is a plain word
 * ("In Search Console" reads "in Search Console"; "WhatsApp" keeps its capital); null for a connector that works today.
 */
export function manualPathLine(connector: KitConnector): string | null {
  if (!planned(connector) || !filled(connector.manualPath)) return null;
  const path = connector.manualPath.trim();
  if (path.startsWith(MANUAL_PATH_LEAD)) return path;
  const [first] = path.split(/\s/, 1);
  const plainWord = /^[A-Z][a-z]+[,.:]?$/.test(first);
  return `${MANUAL_PATH_LEAD}${plainWord ? `${first[0].toLowerCase()}${path.slice(1)}` : path}`;
}

/** The connector a step needs, by the definition's connector id or its catalogue id; null when it needs none. */
function connectorOf(definition: Pick<PlaybookDefinition, 'connectors'>, step: KitStep): KitConnector | null {
  if (!step.connector) return null;
  return definition.connectors.find(item => item.id === step.connector || item.catalogueId === step.connector) ?? null;
}

/**
 * Refuses (MANUAL_PATH_MISSING) a definition with a planned connector that names no manual path or no outside party it
 * waits on, or a step whose connector the playbook does not list.
 */
export function validateManualPaths(definition: Pick<PlaybookDefinition, 'connectors' | 'steps'>): void {
  for (const connector of definition.connectors) {
    if (!planned(connector)) continue;
    check(filled(connector.manualPath), 'MANUAL_PATH_MISSING', `${connector.name} is planned, so it needs the manual path a person takes until it works.`);
    check(filled(connector.waitsOn), 'MANUAL_PATH_MISSING', `${connector.name} is planned, so it needs who it waits on.`);
  }
  for (const step of definition.steps) {
    check(!step.connector || connectorOf(definition, step), 'MANUAL_PATH_MISSING', `The step ${step.id} needs the connector ${step.connector}, which the playbook does not list.`);
  }
}

/**
 * The definition's steps with each manual path line added to the guidance of the step that needs that planned
 * connector, once. The definition itself is not changed; a step that needs nothing planned is returned as it was.
 */
export function withManualPaths(definition: Pick<PlaybookDefinition, 'connectors' | 'steps'>): KitStep[] {
  return definition.steps.map(step => {
    const connector = connectorOf(definition, step);
    const line = connector ? manualPathLine(connector) : null;
    if (!line || step.guidance?.includes(line)) return { ...step };
    return { ...step, guidance: [...(step.guidance ?? []), line] };
  });
}

/** What the order card shows for one step: the connector, who it waits on and the manual path line; null when none. */
export function manualPathFor(definition: Pick<PlaybookDefinition, 'connectors' | 'steps'>, stepId: string): ManualPathView | null {
  const step = definition.steps.find(item => item.id === stepId);
  const connector = step ? connectorOf(definition, step) : null;
  const line = connector ? manualPathLine(connector) : null;
  return line && connector ? { step: stepId, connector: connector.name, waitsOn: connector.waitsOn ?? '', line } : null;
}

/** The manual paths of an order's stages, in stage order: only the stages that need a planned connector. */
export function manualPathsForOrder(definition: Pick<PlaybookDefinition, 'connectors' | 'steps'>, stageIds: readonly string[]): ManualPathView[] {
  return stageIds.flatMap(id => manualPathFor(definition, id) ?? []);
}
