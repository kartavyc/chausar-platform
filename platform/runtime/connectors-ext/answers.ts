import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { norm } from './tabular.ts';
import { DATE_FORMATS } from './values.ts';
import { compileRecipe, type DecoderInput, type RunOptions, type SourceRecipe } from './recipe.ts';
import { DECODERS } from './recipes/index.ts';
import type { Abstention, AbstentionReason } from './types.ts';

/**
 * BK-05, answering a recipe question in place. When a recipe abstains it asks one of five fixed
 * questions; the person's answer becomes a small, data-only change to that recipe for that one
 * source and recipe version. The changed recipe is compiled again before it runs, so an answer can
 * never add code, and its digest changes, so imports made with and without it never collide.
 */
export type Question = { reason: AbstentionReason; field: string; sample: string | null; choices: string[]; target?: 'kind' | 'status' | null };
export type Answer = {
  id: string; sourceId: string; recipeId: string; recipeVersion: string; reason: AbstentionReason; field: string;
  /** For unknown values, which map the value belongs to. */
  target: 'kind' | 'status' | null;
  /** The source's own value (outside text, kept as data only). */
  sample: string | null; choice: string;
  answeredBy: { memberId: string; name: string; role: string; at: string }; envelopeId: string;
};
export const ANSWER_LIMITS = Object.freeze({ answers: 500, sample: 200, recipesKept: 200, heldInputs: 8, heldChars: 64 * 1024 * 1024, heldTtlMs: 6 * 60 * 60 * 1000 });
export const CURRENCY_CHOICES = Object.freeze(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY']);
const LEAVE_OUT = 'leave-out', NO_STATUS = 'no-status';

/** The question an abstention asks, with the exact choices `recipes.answer` will accept. */
export function questionFor(recipe: SourceRecipe, abstention: Abstention | null): Question | null {
  if (!abstention) return null;
  const { reason, field } = abstention;
  const first = typeof abstention.options[0] === 'string' ? abstention.options[0] : null;
  // A value that cannot be a plain map key is never offered as an answer: the question stays open.
  const sample = first !== null && ['__proto__', 'prototype', 'constructor'].includes(first.trim()) ? null : first;
  const words = (values: Readonly<Record<string, string>>) => [...new Set(Object.values(values))].sort();
  const canExclude = !recipe.exclude || recipe.exclude.field === field;
  switch (reason) {
    case 'ambiguous_field': {
      const choices = abstention.options.filter(item => typeof item === 'string' && item.length > 0 && item.length <= ANSWER_LIMITS.sample);
      return choices.length > 1 ? { reason, field, sample: null, choices } : null;
    }
    case 'unknown_value': {
      if (sample === null || sample.length > ANSWER_LIMITS.sample) return null;
      // The kind map is checked before the status map, so a value unknown to the kind map is a kind question.
      const kindMap = 'field' in recipe.kind && recipe.kind.field === field ? recipe.kind.values : null;
      const isKind = !!kindMap && !Object.keys(kindMap).some(key => norm(key) === norm(sample));
      if (isKind) return { reason, field, sample, choices: [...words(kindMap!), ...(canExclude ? [LEAVE_OUT] : [])], target: 'kind' };
      if (recipe.status?.field === field) return { reason, field, sample, choices: [...words(recipe.status.values).filter(Boolean), NO_STATUS, ...(canExclude ? [LEAVE_OUT] : [])], target: 'status' };
      return null;
    }
    case 'date_format': {
      const formats = recipe.fields[field]?.dateFormats ?? [];
      return formats.length > 1 ? { reason, field, sample: null, choices: [...formats] } : null;
    }
    case 'currency':
      return recipe.measure.type === 'money' && 'field' in recipe.measure.currency ? { reason, field, sample: null, choices: [...CURRENCY_CHOICES] } : null;
    case 'sign_convention':
      return recipe.sign && sample !== null && sample.length <= ANSWER_LIMITS.sample ? { reason, field, sample, choices: ['in', 'out'] } : null;
  }
  return null;
}

/** One answer, applied to a plain copy of the recipe. Unusable answers are skipped, never guessed. */
function applyOne(recipe: any, answer: Answer): boolean {
  const field = answer.field;
  switch (answer.reason) {
    case 'ambiguous_field':
      if (!recipe.fields[field]) return false;
      recipe.fields[field].from = [answer.choice]; return true;
    case 'date_format':
      if (!recipe.fields[field] || !(DATE_FORMATS as readonly string[]).includes(answer.choice)) return false;
      recipe.fields[field].dateFormats = [answer.choice]; return true;
    case 'currency':
      if (recipe.measure.type !== 'money' || !('field' in recipe.measure.currency) || !CURRENCY_CHOICES.includes(answer.choice)) return false;
      recipe.measure.currency = { ...recipe.measure.currency, default: answer.choice }; return true;
    case 'sign_convention':
      if (!recipe.sign || recipe.sign.field !== field || answer.sample === null) return false;
      (answer.choice === 'out' ? recipe.sign.negative : recipe.sign.positive).push(answer.sample); return true;
    case 'unknown_value': {
      if (answer.sample === null) return false;
      if (answer.choice === LEAVE_OUT) {
        if (recipe.exclude && recipe.exclude.field !== field) return false;
        recipe.exclude = { field, values: [...(recipe.exclude?.values ?? []), answer.sample] }; return true;
      }
      if (answer.target === 'kind' && 'field' in recipe.kind && recipe.kind.field === field) { recipe.kind.values[answer.sample] = answer.choice; return true; }
      if (answer.target === 'status' && recipe.status?.field === field) { recipe.status.values[answer.sample] = answer.choice === NO_STATUS ? '' : answer.choice; return true; }
      return false;
    }
  }
  return false;
}
/** Answers that apply to this source and this exact recipe version. */
export function answersFor(sourceId: string, recipe: Pick<SourceRecipe, 'id' | 'version'>, all: readonly Answer[]): Answer[] {
  return all.filter(item => item.sourceId === sourceId && item.recipeId === recipe.id && item.recipeVersion === recipe.version);
}
/** The base recipe with these answers, compiled again as data. A set that no longer compiles is refused, not run. */
export function withAnswers(base: SourceRecipe, answers: readonly Answer[]): { recipe: SourceRecipe; applied: string[] } {
  if (!answers.length) return { recipe: base, applied: [] };
  const copy = JSON.parse(JSON.stringify(base)), applied: string[] = [];
  for (const answer of answers) if (applyOne(copy, answer)) applied.push(answer.id);
  if (!applied.length) return { recipe: base, applied };
  return { recipe: compileRecipe(copy, DECODERS), applied };
}

/* ------------------------------------------------------------------ held inputs (memory only) */

export type HeldRead = {
  envelopeId: string; memberId: string; expiresAt: number; chars: number;
  base: SourceRecipe; input: DecoderInput; options: RunOptions; ocrNotice: string | null;
  connectionId: string | null; target: { sourceId: string; company: string; branch: string };
  road: 'interface' | 'file' | 'screen' | 'database'; requestedPeriod: { from: string; to: string } | null;
  read: { pages: number; requests: number; bytes: number; parts?: number } | null;
};
/**
 * The input of a read that asked a question, so the answer can be tried at once. Keyed by the open
 * vault object like FR-07 passwords: locking drops it. Never written to disk, backed up or logged.
 */
const holds = new WeakMap<object, Map<string, HeldRead>>();
function heldMap(host: ModuleHost): Map<string, HeldRead> {
  const vault = host.store as object; let map = holds.get(vault);
  if (!map) { map = new Map(); holds.set(vault, map); }
  for (const [key, item] of map) if (item.expiresAt <= Date.now()) map.delete(key);
  return map;
}
export function inputChars(input: DecoderInput): number {
  if (typeof input.text === 'string') return input.text.length;
  if (input.rows) { let n = 0; for (const row of input.rows) for (const cell of row) n += String(cell).length + 1; return n; }
  try { return JSON.stringify(input.records ?? []).length; } catch { return Number.MAX_SAFE_INTEGER; }
}
export function holdRead(host: ModuleHost, item: Omit<HeldRead, 'expiresAt' | 'chars'>): void {
  const chars = inputChars(item.input);
  if (chars > ANSWER_LIMITS.heldChars) return;
  const map = heldMap(host);
  map.set(item.envelopeId, { ...item, chars, expiresAt: Date.now() + ANSWER_LIMITS.heldTtlMs });
  // Oldest first out, by count and by size.
  let total = [...map.values()].reduce((sum, held) => sum + held.chars, 0);
  for (const key of map.keys()) {
    if (map.size <= ANSWER_LIMITS.heldInputs && total <= ANSWER_LIMITS.heldChars) break;
    total -= map.get(key)!.chars; map.delete(key);
  }
}
/** Taking a held read removes it: each held input is tried with one answer, once. */
export function takeRead(host: ModuleHost, ctx: Context, envelopeId: string): HeldRead | null {
  const map = heldMap(host), item = map.get(envelopeId) ?? null;
  if (!item || item.memberId !== ctx.memberId) return null;
  map.delete(envelopeId);
  return item;
}

/* ------------------------------------------------------------------ version diff */

export type Change = { path: string; change: 'added' | 'removed' | 'changed'; before: string | null; after: string | null; effect: 'columns' | 'meaning' | 'dates' | 'amount' | 'check' | 'identity' | 'other' };
const list = (values: readonly string[] | undefined) => values ? values.join(' | ') : undefined;
function flatten(recipe: SourceRecipe): Map<string, string> {
  const out = new Map<string, string>(), put = (path: string, value: unknown) => { if (value !== undefined && value !== null) out.set(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  put('decoder', recipe.decoder); put('sensitivity', recipe.sensitivity); put('header', recipe.header?.map(group => group.join(' + ')).join(' | '));
  put('records', list(recipe.records)); put('identity', list(recipe.identity)); put('ignored', list(recipe.ignored));
  for (const [name, spec] of Object.entries(recipe.fields)) {
    put(`fields.${name}.from`, list(spec.from)); put(`fields.${name}.type`, spec.type); put(`fields.${name}.required`, spec.required === true ? 'yes' : 'no');
    put(`fields.${name}.dateFormats`, list(spec.dateFormats));
  }
  const m = recipe.measure;
  put('measure.type', m.type);
  if (m.type === 'money') {
    put('measure.amount', 'field' in m.amount ? m.amount.field : `${m.amount.credit} - ${m.amount.debit}`); put('measure.unit', m.unit);
    if ('constant' in m.currency) put('measure.currency', m.currency.constant);
    else { put('measure.currency', `column ${m.currency.field}`); put('measure.currency.default', m.currency.default); }
  } else { put('measure.amount', m.field); put('measure.unit', m.unit); }
  if ('constant' in recipe.kind) put('kind.constant', recipe.kind.constant);
  else { put('kind.field', recipe.kind.field); for (const [key, value] of Object.entries(recipe.kind.values)) put(`kind.values.${key}`, value); }
  if (recipe.status) { put('status.field', recipe.status.field); for (const [key, value] of Object.entries(recipe.status.values)) put(`status.values.${key}`, value === '' ? '(none)' : value); }
  if (recipe.exclude) { put('exclude.field', recipe.exclude.field); put('exclude.values', list(recipe.exclude.values)); }
  if (recipe.sign) { put('sign.field', recipe.sign.field); put('sign.out', list(recipe.sign.negative)); put('sign.in', list(recipe.sign.positive)); }
  for (const [target, source] of Object.entries(recipe.outputs ?? {})) put(`outputs.${target}`, source);
  const { kind, ...rest } = recipe.totals as Record<string, unknown>;
  put('totals.kind', kind); for (const [key, value] of Object.entries(rest)) put(`totals.${key}`, Array.isArray(value) ? list(value as string[]) : value);
  return out;
}
function effectOf(path: string): Change['effect'] {
  if (/^fields\.[^.]+\.dateFormats$/.test(path)) return 'dates';
  if (/^fields\.|^header$|^records$|^ignored$|^decoder$/.test(path)) return 'columns';
  if (/^(kind|status|exclude|outputs)\./.test(path)) return 'meaning';
  if (/^(measure|sign)\./.test(path)) return 'amount';
  if (/^totals\./.test(path)) return 'check';
  if (path === 'identity') return 'identity';
  return 'other';
}
/** Every difference between two recipes, path by path. Values are recipe words, never source rows. */
export function diffRecipes(from: SourceRecipe, to: SourceRecipe): Change[] {
  const a = flatten(from), b = flatten(to), changes: Change[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const before = a.get(path) ?? null, after = b.get(path) ?? null;
    if (before === after) continue;
    changes.push({ path, change: before === null ? 'added' : after === null ? 'removed' : 'changed', before, after, effect: effectOf(path) });
  }
  return changes;
}
