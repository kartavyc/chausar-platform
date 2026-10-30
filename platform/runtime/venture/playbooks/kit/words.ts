// Chausar playbook kit: the words a kit playbook shows people, their checks and their Hindi (Ink v2 wave 5, package
// 5A1). Every string a playbook shows (its words(), plus the standard ones the kit reads from the definition: label,
// summary, offers, roles, steps, approvals, intake fields and the tile) passes the house style, the done-claim check
// and the no-numbers rule, and has its Hindi in playbooks/<id>/hi.json, a flat map from the English to the Hindi with
// "_review": "machine-drafted, needs a native reviewer". hiOf looks one up. Written for Chausar; nothing here is
// learned from an outside source.
import { readFileSync } from 'node:fs';
import { assertNoNumbers, doneClaimFindings, houseStyleFindings } from '../../records.ts';
import type { PlaybookDefinition } from './define.ts';
import { recipeJudgeRules } from './recipes.ts';

/** The review mark every kit playbook's hi.json carries. */
export const HI_REVIEW = 'machine-drafted, needs a native reviewer';
/** A playbook's Hindi: each English string to its Hindi, and the review mark. */
export type HiFile = Readonly<Record<string, string>>;

const DEVANAGARI = /\p{Script=Devanagari}/u;
const HIDDEN = /[\p{Cf}\u0000-\u001F\u007F-\u009F]/u;
const cache = new Map<string, HiFile>();
const installed = new Map<string, HiFile>();

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

/** Why a playbook's Hindi for one string is not usable, or null: missing, empty, not Hindi, or with a hidden character. */
export function hiProblem(hi: HiFile, english: string): string | null {
  const hindi = Object.hasOwn(hi, english) ? hi[english] : undefined;
  if (typeof hindi !== 'string' || !hindi.trim()) return 'has no Hindi in hi.json';
  if (!DEVANAGARI.test(hindi) || HIDDEN.test(hindi)) return 'has Hindi in hi.json that is not readable Hindi';
  return null;
}

/** A playbook's hi.json from its folder (playbooks/<id>/hi.json), read once; an empty map when it has none. */
export function loadHi(playbookId: string): HiFile {
  const ready = installed.get(playbookId) ?? cache.get(playbookId);
  if (ready) return ready;
  let parsed: HiFile = {};
  try {
    const raw = JSON.parse(readFileSync(new URL(`../${playbookId}/hi.json`, import.meta.url), 'utf8')) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = Object.freeze({ ...(raw as Record<string, string>) });
  } catch {
    parsed = {};
  }
  cache.set(playbookId, parsed);
  return parsed;
}

/** Keeps a playbook's Hindi given in code (a test's definition, which has no folder), so hiOf finds it. */
export function keepHi(playbookId: string, hi: HiFile): void {
  installed.set(playbookId, Object.freeze({ ...hi }));
}

/** Forgets Hindi kept with keepHi (a test puts its fixture back). */
export function forgetHi(playbookId: string): void {
  installed.delete(playbookId);
}

/** The Hindi for one of a playbook's English strings, or the English when there is none (a definition never lands without it). */
export function hiOf(playbookId: string, english: string): string {
  const hi = loadHi(playbookId);
  return hiProblem(hi, english) ? english : hi[english]!;
}
