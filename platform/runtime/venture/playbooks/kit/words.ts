// Every playbook display string passes the English house style, done-claim and no-numbers checks.
import { assertNoNumbers, doneClaimFindings, houseStyleFindings } from '../../records.ts';
import type { PlaybookDefinition } from './define.ts';
import { recipeJudgeRules } from './recipes.ts';

const HIDDEN = /[\p{Cf}\u0000-\u001F\u007F-\u009F]/u;

/**
 * The standard strings a kit definition shows, read from its fields: the label and summary, each offer's name,
 * description and unit, each role's name and job, each step's title, each approval's words, each intake field's label
 * and help, each connector's name, note, manual path and who it waits on, each judge rule's question and text, what is
 * never built, the scope, and the tile's lines and what the pay is per. The playbook's own words() adds the rest.
 * 5A3: also each dated rule's topic, words, how it was read and limits (its value and unit are data), each recipe's
 * words, each measurement boundary, and the judge rules the recipes' mistakes make, read from the recipes so they are
 * checked before definePlaybook merges them.
 */
export function standardWords(definition: Pick<PlaybookDefinition, 'registration' | 'offers' | 'roles' | 'steps' | 'approvals' | 'intakeFields' | 'startTile' | 'connectors' | 'judgeRules' | 'notBuilt' | 'scope' | 'rules' | 'recipes' | 'boundaries'>): string[] {
  const tile = definition.startTile;
  return [...new Set([
    definition.registration.label, definition.registration.summary,
    ...definition.offers.flatMap(offer => [offer.name, offer.description, offer.unit]),
    ...definition.roles.flatMap(role => [role.name, role.job]),
    ...definition.steps.map(step => step.title),
    ...definition.approvals.map(approval => approval.words),
    ...definition.intakeFields.flatMap(field => [field.label, field.help, ...(field.options ?? [])]),
    ...definition.connectors.flatMap(connector => [connector.name, connector.note, connector.manualPath ?? '', connector.waitsOn ?? '']),
    ...definition.judgeRules.flatMap(rule => [rule.question, rule.text]),
    ...(definition.rules ?? []).flatMap(rule => [rule.topic, rule.rule, rule.how, rule.limitations]),
    ...(definition.recipes ?? []).flatMap(recipe => [recipe.name, recipe.whenToUse, ...recipe.steps.flatMap(step => [step.do, step.why]), recipe.howToRead, ...recipe.mistakes.map(item => item.text)]),
    ...recipeJudgeRules(definition.recipes ?? []).flatMap(rule => [rule.question, rule.text]),
    ...(definition.boundaries ?? []).flatMap(row => [row.evidence, row.canSay, row.cannotSay]),
    ...definition.notBuilt,
    ...definition.scope.inScope, ...definition.scope.outOfScope, definition.scope.pointElsewhere,
    tile.line, tile.youDo.line, tile.team.line, tile.pay.per,
  ].filter(text => typeof text === 'string' && text.length > 0))];
}

/** Every string a definition shows: the standard ones and its own words(), each once. */
export function allWords(definition: PlaybookDefinition): string[] {
  return [...new Set([...standardWords(definition), ...definition.words()])];
}

/**
 * Why one shown string breaks the kit's word rules, or null: hidden characters, an em dash or an AI-tell word, a claim
 * of finished work, or a number (figures are data and labelled, never words).
 */
export function wordProblem(text: string): string | null {
  if (HIDDEN.test(text)) return 'has a hidden character';
  if (houseStyleFindings(text).length) return 'breaks house style';
  if (doneClaimFindings(text).length) return 'claims finished work';
  try { assertNoNumbers(text, 'words'); } catch { return 'holds a number'; }
  return null;
}
