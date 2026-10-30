// Shared by the playbook kit's rule, recipe and manual-path tests (Ink v2 wave 5, package 5A3): a small kit definition
// with only the parts these tests read (steps, check ids, connectors, dated rules, recipes and boundaries). It stands
// for any business package's definition; it is never registered, so the shipped lists stay as they are.
import type { DatedRule, KitBoundary, KitConnector, KitRecipe, KitStep, PlaybookDefinition } from '../runtime/venture/playbooks/kit/define.ts';

export const FIXTURE_ID = 'kit-rules-fixture';
export const TODAY = '2026-10-27';

const step = (id: string, title: string, extra: Partial<KitStep> = {}): KitStep => ({
  id, kind: 'write', title, tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: [], checks: [], role: 'writer', produces: title, ...extra,
} as KitStep);

export const FIXTURE_STEPS: readonly KitStep[] = [
  step('gather', 'Gather the numbers', { connector: 'search-console', guidance: ['Read the client\'s numbers first.'] }),
  step('draft', 'Write the report'),
  step('send', 'Send the report', { connector: 'client-mail' }),
];
export const FIXTURE_CHECKS = ['figures-match', 'claims-bounded', 'length-fits'];

export const FIXTURE_CONNECTORS: readonly KitConnector[] = [
  {
    id: 'search-console', name: 'Google Search Console', label: 'planned: read', note: 'Reads the clicks and searches for the client site.',
    manualPath: 'In Search Console open Performance, choose Export, and add the CSV to the order.', waitsOn: 'Google approving the app for Search Console reads',
  },
  { id: 'client-mail', name: 'Your mail app', label: 'handoff', note: 'You send it from your own mail.' },
];

export function rule(id: string, extra: Partial<DatedRule> = {}): DatedRule {
  return {
    id, scope: 'google', topic: `Rule ${id}`, rule: 'Search Console keeps sixteen months of data.', value: '16', unit: 'months',
    sources: [{ title: 'Search Console Help: Performance report', url: 'https://support.google.com/webmasters/answer/7576553' }],
    checkedOn: '2026-10-20', read: 'official', how: 'Read on the Search Console help page on 20 October 2026.', usedBy: ['gather', 'figures-match'],
    limitations: 'Says nothing about data kept by other tools.', needs: null, ...extra,
  };
}

export const FIXTURE_RULES: readonly DatedRule[] = [
  rule('gsc-sixteen-months'),
  rule('house-no-guarantee', {
    scope: 'all', topic: 'No ranking promises', rule: 'Never promise a ranking or a number of clicks.', value: undefined, unit: undefined, sources: [], read: 'house',
    how: "Chausar's own rule, set on 20 October 2026.", usedBy: ['claims-bounded'], limitations: 'A rule for our own words, not a platform rule.',
  }),
];

export const FIXTURE_RECIPES: readonly KitRecipe[] = [{
  id: 'traffic-drop', name: 'Find why traffic dropped', whenToUse: 'When clicks fell by a lot in one week.',
  steps: [
    { do: 'Compare the last 28 days with the 28 before.', why: 'A week is too short to tell a drop from a holiday.' },
    { do: 'Split by page, then by search words.', why: 'One page often explains most of the drop.' },
  ],
  howToRead: 'A drop on one page is a page problem; a drop on every page is a site or season problem.',
  mistakes: [
    { text: 'Blaming an update without dates that match.', judge: true },
    { text: 'Comparing a holiday week with a normal one.' },
  ],
}];

export const FIXTURE_BOUNDARIES: readonly KitBoundary[] = [
  { evidence: 'A JSON-LD block parsed', canSay: 'The page carries structured data a parser can read.', cannotSay: 'The page is eligible for rich results.' },
];

/** The fixture definition, with any part replaced. */
export function fixtureDefinition(patch: Partial<PlaybookDefinition> = {}): PlaybookDefinition {
  return {
    registration: { id: FIXTURE_ID, label: 'Rules fixture', riskLevel: 'low', lastReviewed: '2026-10-20' },
    steps: FIXTURE_STEPS, checkIds: FIXTURE_CHECKS, connectors: FIXTURE_CONNECTORS, rules: FIXTURE_RULES, recipes: FIXTURE_RECIPES, boundaries: FIXTURE_BOUNDARIES,
    judgeRules: [],
    ...patch,
  } as unknown as PlaybookDefinition;
}
