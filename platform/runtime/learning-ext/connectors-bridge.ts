/**
 * The learning loop inside the connectors-ext import path (ladder step 1 and the decision log).
 *
 * Before a registered connector recipe is run on a file, the file's column names are compared with
 * the recipe library (base recipes, reconciled imports on this computer, saved recipes) and with the
 * registered connector recipes that read the same kind of input. The ranked suggestions travel with
 * the preview. Accepting, discarding or overriding the suggestion is logged as a structural event:
 * vocabulary words only, never a column name, a value or an amount.
 *
 * Every function here is best effort: connectors-ext results and refusals never depend on it.
 */
import type { Context, State } from '../contracts.ts';
import { RECIPES, DECODERS } from '../connectors-ext/recipes/index.ts';
import type { Decoder, DecoderInput, SourceRecipe } from '../connectors-ext/recipe.ts';
import type { Envelope } from '../connectors-ext/state.ts';
import { familyOf, lookup, normalizeHeader } from './recipes.ts';
import { logOf, recordDecision } from './log.ts';
import { canonicalFieldName } from './structure.ts';
import { canSee } from './state.ts';
import type { FieldName, FieldType, Reason, ReportShape, StructuralEvent, SystemFamily } from './vocabulary.ts';

export type LibrarySuggestion = { id: string; origin: 'local' | 'saved' | 'base' | 'registered'; system: string; recipeId: string; score: number; passedTests: boolean; matched: string[] };
export type LibraryView = { suggestions: LibrarySuggestion[]; chosen: { recipeId: string; rank: number | null; score: number }; agrees: boolean | null };

/** Connector groups whose names differ from the registered system families. */
const GROUP_FAMILY: Record<string, SystemFamily> = { 'gst-downloads': 'gst-portal', 'gst-provider': 'gst-portal', 'form26as-ais': 'income-tax', 'bank-statements': 'bank', 'amazon-seller': 'amazon', 'flipkart-seller': 'flipkart' };
export const connectorFamily = (group: string): SystemFamily => GROUP_FAMILY[group] ?? familyOf(group) as SystemFamily;
const SHAPES: [RegExp, ReportShape][] = [[/gstr|einvoice|eway/, 'gst-return'], [/^statement$/, 'bank-statement'], [/settlement|payout|remittance/, 'settlement'], [/invoice/, 'invoice'],
  [/order/, 'order'], [/payroll|salary/, 'payroll'], [/inventory|stock/, 'stock'], [/register|ledger/, 'ledger'], [/collection|payment/, 'receipt'], [/daily|report|summary|form26as|ais/, 'summary']];
export const connectorShape = (operation: string): ReportShape | undefined => SHAPES.find(([pattern]) => pattern.test(operation))?.[1];
const TYPE: Record<string, FieldType> = { text: 'string', money: 'decimal', date: 'date', integer: 'integer' };
/** The recipe's canonical outputs as vocabulary pairs; source headings never enter. */
function connectorFields(recipe: SourceRecipe): [FieldName, FieldType][] {
  const pairs: [string, FieldType][] = [['reference', 'string'], ['date', 'date']];
  pairs.push(recipe.measure.type === 'money' ? ['amount', 'decimal'] : ['quantity', 'integer']);
  if (recipe.measure.type === 'money' && 'field' in recipe.measure.currency) pairs.push(['currency', 'string']);
  if ('field' in recipe.kind) pairs.push(['kind', 'string']);
  if (recipe.status) pairs.push(['status', 'string']);
  for (const [output, source] of Object.entries(recipe.outputs ?? {})) { const type = TYPE[recipe.fields[source]?.type ?? 'text']; if (type) pairs.push([output, type]); }
  return pairs.map(([name, type]) => [canonicalFieldName(name), type] as const).filter((pair): pair is [FieldName, FieldType] => !!pair[0]);
}

function headings(decoder: Decoder, input: DecoderInput, recipe: SourceRecipe): string[] {
  try { return [...new Set(decoder.decode(input, recipe).headers.filter(name => typeof name === 'string' && name.length > 0 && name.length <= 200))].slice(0, 500); } catch { return []; }
}
/** The head of a file, cut at a line end, so locating a header row with other recipes stays cheap. */
function sampleOf(input: DecoderInput): DecoderInput {
  if (typeof input.text === 'string' && input.text.length > 65_536) return { ...input, text: input.text.slice(0, input.text.lastIndexOf('\n', 65_536) + 1) };
  return input.rows ? { ...input, rows: input.rows.slice(0, 200) } : input;
}
/**
 * The file's own column names, decoded once more by the registered decoder. When the chosen recipe
 * cannot find its header row (often the sign of a wrong choice), the other recipes for the same
 * decoder try to locate it on the file's head; nothing if none can.
 */
export function fileColumns(decoder: Decoder, input: DecoderInput, recipe: SourceRecipe): string[] {
  const own = headings(decoder, input, recipe);
  if (own.length) return own;
  const sample = sampleOf(input);
  for (const other of RECIPES.values()) if (other.decoder === recipe.decoder && other.id !== recipe.id) { const found = headings(decoder, sample, other); if (found.length) return found; }
  return [];
}
/** Shared columns over the union of the file's columns and the recipe's fields (each field counts once), plus a system bonus. */
function scoreRegistered(recipe: SourceRecipe, columns: Map<string, string>, family: string) {
  const aliases = Object.values(recipe.fields).map(spec => new Set(spec.from.map(normalizeHeader).filter(Boolean)));
  const matched = [...columns.keys()].filter(key => aliases.some(set => set.has(key)));
  const missing = aliases.filter(set => ![...set].some(key => columns.has(key))).length;
  const union = columns.size + missing;
  const overlap = union === 0 ? 0 : Math.floor(matched.length * 100 / union);
  return { score: Math.min(100, overlap + (family !== 'other' && family === connectorFamily(recipe.group) ? 20 : 0)), matched: matched.map(key => columns.get(key)!) };
}
const ORIGIN = { local: 0, saved: 1, registered: 2, base: 3 } as const;

/**
 * Ladder step 1 for a connector preview: the library's similar past setups and the registered
 * connector recipes for the same input kind, ranked by score. A reconciled local import made by a
 * connector recipe is scored by that recipe's headings, since its retained recipe is the canonical one.
 */
export function connectorLibrary(state: State, ctx: Context, input: { columns: string[]; chosen: SourceRecipe; limit?: number }): LibraryView {
  try { return rank(state, ctx, input); } catch { return { suggestions: [], chosen: { recipeId: input.chosen.id, rank: null, score: 0 }, agrees: null }; }
}
function rank(state: State, ctx: Context, input: { columns: string[]; chosen: SourceRecipe; limit?: number }): LibraryView {
  const chosen = input.chosen, family = connectorFamily(chosen.group), limit = input.limit ?? 3;
  const columns = new Map(input.columns.map(name => [normalizeHeader(name), name] as const).filter(([key]) => key.length > 0));
  const accepts = DECODERS.get(chosen.decoder)?.accepts;
  const registered = new Map<string, LibrarySuggestion>();
  for (const recipe of RECIPES.values()) {
    if (DECODERS.get(recipe.decoder)?.accepts !== accepts) continue;
    const { score, matched } = scoreRegistered(recipe, columns, family);
    registered.set(recipe.id, { id: `registered:${recipe.id}`, origin: 'registered', system: connectorFamily(recipe.group), recipeId: recipe.id, score, passedTests: true, matched });
  }
  const items: LibrarySuggestion[] = [...registered.values()];
  if (columns.size > 0) {
    // A reconciled connector import keeps a canonical recipe ('cx-<id>'), so it is scored by its own connector recipe's headings instead.
    for (const item of lookup(state, ctx, { fields: [...columns.values()], system: family === 'other' ? undefined : family, limit: 500 })) if (!(item.origin === 'local' && item.recipeId.startsWith('cx-'))) items.push({ ...item, matched: [...item.matched] });
    const local = new Set<string>();
    for (const record of [...state.imports].reverse()) {
      const id = String(record?.retainedInput?.input?.recipe?.id ?? ''), base = id.startsWith('cx-') ? registered.get(id.slice(3)) : undefined;
      if (!base || local.has(base.recipeId) || record.coverage?.reconciled !== true || !canSee(state, ctx, [record.sourceId])) continue;
      local.add(base.recipeId); items.push({ ...base, id: `local:${record.id}`, origin: 'local' });
    }
  }
  // A family bonus alone is not similarity: a suggestion shares at least one column with the file.
  const ranked = items.filter(item => item.score > 0 && item.matched.length > 0).sort((a, b) => b.score - a.score || Number(b.passedTests) - Number(a.passedTests) || ORIGIN[a.origin] - ORIGIN[b.origin] || a.id.localeCompare(b.id));
  const at = ranked.findIndex(item => item.recipeId === chosen.id);
  return { suggestions: ranked.slice(0, limit), chosen: { recipeId: chosen.id, rank: at < 0 ? null : at + 1, score: at < 0 ? 0 : ranked[at].score }, agrees: ranked.length ? ranked[0].recipeId === chosen.id : null };
}
function eventFor(envelope: Envelope, choice: StructuralEvent['choice'], reason?: Reason): StructuralEvent | null {
  const recipe = RECIPES.get(envelope.recipeId);
  const shape = connectorShape(envelope.operation);
  return { kind: 'mapping', choice, ...(reason ? { reason } : {}), system: connectorFamily(envelope.group), ...(shape ? { shape } : {}), ...(recipe ? { fields: connectorFields(recipe) } : {}) };
}
/** Log one decision about an envelope inside the caller's transaction; a refused log never breaks the import. */
function log(state: State, ctx: Context, envelope: Envelope, choice: StructuralEvent['choice'], reason?: Reason, refs: string[] = []) {
  try { return recordDecision(state, ctx, { event: eventFor(envelope, choice, reason), sourceIds: [envelope.sourceId], refs: [envelope.id, ...refs] }).id; } catch { return null; }
}

/** At preview: following the library's top suggestion is logged as proposed, choosing another recipe as corrected. */
export function recordConnectorPreview(state: State, ctx: Context, envelope: Envelope, view: LibraryView): string | null {
  if (view.agrees === null) return null;
  return view.agrees ? log(state, ctx, envelope, 'proposed', 'library-match') : log(state, ctx, envelope, 'corrected', 'owner-override');
}
/** At commit: accepted, by library match when the preview followed the library, otherwise by reconciliation with the source totals. */
export function recordConnectorCommit(state: State, ctx: Context, envelope: Envelope): string | null {
  const followed = logOf(state).some(entry => entry.refs.includes(envelope.id) && entry.event.choice === 'proposed' && entry.event.reason === 'library-match');
  return log(state, ctx, envelope, 'accepted', followed ? 'library-match' : 'reconciliation', envelope.committed ? [envelope.committed.importId] : []);
}
/** At discard: a waiting import that is thrown away is logged as rejected. */
export function recordConnectorDiscard(state: State, ctx: Context, envelope: Envelope): string | null {
  return envelope.pending && !envelope.committed ? log(state, ctx, envelope, 'rejected') : null;
}
